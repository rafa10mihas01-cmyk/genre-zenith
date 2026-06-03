// spotify-app01-audit — evidência HTTP completa de /tracks no App 01
// Body: { spotify_user_id?, playlist_id?, test_track_uri?, cleanup? }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_01_ID = "d0676425-59bc-40a1-94ad-d96ce7b483c4";
const DEFAULT_USER = "31r2keeilv4bqululjdcpjgatlim"; // Lado Sul Produtora
const DEFAULT_TRACK = "spotify:track:11dFghVXANMlKmJXsNCbNl";

async function refreshIfNeeded(sb: ReturnType<typeof createClient>, row: any): Promise<string> {
  if (new Date(row.expires_at).getTime() > Date.now() + 60_000) return row.access_token;
  const { data: app } = await sb.from("spotify_apps").select("client_id, client_secret").eq("id", row.app_id).maybeSingle();
  if (!app) throw new Error("app not found");
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${app.client_id}:${app.client_secret}`) },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`refresh ${r.status} ${JSON.stringify(j)}`);
  await sb.from("spotify_user_tokens").update({
    access_token: j.access_token,
    expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
    refresh_token: j.refresh_token ?? row.refresh_token,
  }).eq("id", row.id);
  return j.access_token;
}

async function call(token: string, method: string, url: string, body?: unknown, label = "") {
  const t0 = Date.now();
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let parsed: any = txt;
  try { parsed = txt ? JSON.parse(txt) : null; } catch { /* */ }
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  return {
    label, method, url,
    http_status: r.status,
    ok: r.ok,
    duration_ms: Date.now() - t0,
    spotify_request_id: r.headers.get("x-spotify-request-id"),
    retry_after: r.headers.get("retry-after"),
    response_headers: headers,
    body: parsed,
  };
}

async function waitFor429(token: string, url: string, maxWaitMs = 90_000): Promise<{ waited_ms: number; final_status: number; attempts: number }> {
  const start = Date.now();
  let attempts = 0;
  while (Date.now() - start < maxWaitMs) {
    attempts++;
    const r = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    await r.text();
    if (r.status !== 429) return { waited_ms: Date.now() - start, final_status: r.status, attempts };
    const ra = parseInt(r.headers.get("retry-after") ?? "5", 10);
    await new Promise((res) => setTimeout(res, Math.min(30_000, Math.max(1000, ra * 1000))));
  }
  return { waited_ms: Date.now() - start, final_status: 429, attempts };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const uid = body.spotify_user_id ?? DEFAULT_USER;
  const trackUri = body.test_track_uri ?? DEFAULT_TRACK;
  const cleanup = body.cleanup !== false;

  const { data: tokens } = await sb.from("spotify_user_tokens").select("*")
    .eq("spotify_user_id", uid).eq("app_id", APP_01_ID)
    .order("updated_at", { ascending: false }).limit(1);
  if (!tokens?.length) return new Response(JSON.stringify({ error: "no token for App 01 user" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const row = tokens[0];
  const token = await refreshIfNeeded(sb, row);

  const out: Record<string, unknown> = {
    app: { id: APP_01_ID, name: "NexEngine (App 01)" },
    token_meta: { token_id: row.id, spotify_user_id: row.spotify_user_id, display_name: row.display_name, scope: row.scope, updated_at: row.updated_at },
  };

  // Aguardar 429 liberar antes dos testes
  out.wait_for_429 = await waitFor429(token, "https://api.spotify.com/v1/me");

  // 1. GET /me
  out.step1_get_me = await call(token, "GET", "https://api.spotify.com/v1/me", undefined, "GET /me");

  // Escolher playlist
  let playlistId: string = body.playlist_id ?? "";
  let createdHere = false;
  if (!playlistId) {
    const list = await call(token, "GET", "https://api.spotify.com/v1/me/playlists?limit=50", undefined, "GET /me/playlists");
    const meId = (out.step1_get_me as any)?.body?.id;
    const items: any[] = (list.body as any)?.items ?? [];
    const owned = items.filter((p) => p?.owner?.id === meId);
    const pick = owned.find((p) => (p?.tracks?.total ?? 0) > 0) ?? owned[0];
    if (pick) {
      playlistId = pick.id;
      out.pick_existing = { id: pick.id, name: pick.name, total: pick?.tracks?.total };
    } else {
      const c = await call(token, "POST", "https://api.spotify.com/v1/me/playlists", { name: `app01-audit ${new Date().toISOString()}`, public: false }, "POST create");
      playlistId = (c.body as any)?.id;
      createdHere = !!playlistId;
      out.create = c;
    }
  }
  out.playlist_id = playlistId;
  if (!playlistId) return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // 2. GET /playlists/{id}
  out.step2_get_playlist = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}`, undefined, "GET /playlists/{id}");

  // 3. GET /playlists/{id}/tracks
  out.step3_get_tracks = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=10`, undefined, "GET /playlists/{id}/tracks");

  // 4. POST /playlists/{id}/tracks
  out.step4_post_tracks = await call(token, "POST", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`, { uris: [trackUri] }, "POST /playlists/{id}/tracks");

  // 5. DELETE /playlists/{id}/tracks
  out.step5_delete_tracks = await call(token, "DELETE", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`, { tracks: [{ uri: trackUri }] }, "DELETE /playlists/{id}/tracks");

  out.summary = {
    get_me: (out.step1_get_me as any).http_status,
    get_playlist: (out.step2_get_playlist as any).http_status,
    get_tracks: (out.step3_get_tracks as any).http_status,
    post_tracks: (out.step4_post_tracks as any).http_status,
    delete_tracks: (out.step5_delete_tracks as any).http_status,
  };

  const s = out.summary as any;
  out.verdict = (s.get_tracks === 200 && s.post_tracks >= 200 && s.post_tracks < 300 && s.delete_tracks === 200)
    ? "CENARIO_A — App 01 tem acesso ao endpoint legado /tracks (permissão diferente dos Apps 05–08)"
    : (s.get_tracks === 403 && s.post_tracks === 403 && s.delete_tracks === 403)
    ? "CENARIO_B — App 01 também bloqueado: política global no ecossistema"
    : "MIXED — inspecionar status individuais";

  if (createdHere && cleanup) {
    out.cleanup = await call(token, "DELETE", `https://api.spotify.com/v1/playlists/${playlistId}/followers`, undefined, "cleanup");
  }

  return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
