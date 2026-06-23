// spotify-app01-multiowner — tenta todos os owners do App 01 até achar um sem 429
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_01_SLUG = "nexengine";
const DEFAULT_TRACK = "spotify:track:11dFghVXANMlKmJXsNCbNl";


async function refreshIfNeeded(sb: ReturnType<typeof createClient>, row: any): Promise<string> {
  if (new Date(row.expires_at).getTime() > Date.now() + 60_000) return row.access_token;
  const { data: app } = await sb.from("spotify_apps").select("client_id, client_secret").eq("id", row.app_id).maybeSingle();
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${app!.client_id}:${app!.client_secret}`) },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`refresh ${r.status}`);
  await sb.from("spotify_user_tokens").update({
    access_token: j.access_token,
    expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
    refresh_token: j.refresh_token ?? row.refresh_token,
  }).eq("id", row.id);
  return j.access_token;
}

async function call(token: string, method: string, url: string, body?: unknown) {
  const t0 = Date.now();
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let parsed: any = txt; try { parsed = txt ? JSON.parse(txt) : null; } catch { /* */ }
  return {
    method, url,
    http_status: r.status,
    duration_ms: Date.now() - t0,
    spotify_request_id: r.headers.get("x-spotify-request-id"),
    retry_after: r.headers.get("retry-after"),
    body: parsed,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const trackUri = body.test_track_uri ?? DEFAULT_TRACK;

  const { data: app } = await sb.from("spotify_apps").select("id, name").eq("slug", APP_01_SLUG).maybeSingle();
  if (!app?.id) return new Response(JSON.stringify({ error: `app slug ${APP_01_SLUG} not found` }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const APP_01_ID = app.id as string;

  const { data: tokens } = await sb.from("spotify_user_tokens").select("*")
    .eq("app_id", APP_01_ID).order("updated_at", { ascending: false });
  if (!tokens?.length) return new Response(JSON.stringify({ error: "no tokens" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const out: Record<string, unknown> = { app: { id: APP_01_ID, name: app.name ?? "App 01" }, owners_tried: [] };

  let liveOwner: any = null;
  const probes: any[] = [];

  for (const row of tokens) {
    const token = await refreshIfNeeded(sb, row);
    const me = await call(token, "GET", "https://api.spotify.com/v1/me");
    probes.push({ display_name: row.display_name, spotify_user_id: row.spotify_user_id, get_me_status: me.http_status, retry_after: me.retry_after });
    if (me.http_status === 200) {
      liveOwner = { row, token, me };
      break;
    }
  }
  out.owners_tried = probes;

  if (!liveOwner) {
    out.verdict = "ALL_OWNERS_RATE_LIMITED — todos os usuários do App 01 estão em 429 (Retry-After até 24h). Não é possível coletar evidência agora.";
    return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { row, token, me } = liveOwner;
  out.selected_owner = { display_name: row.display_name, spotify_user_id: row.spotify_user_id, scope: row.scope };
  out.step1_get_me = me;

  // Pick or create playlist
  let playlistId: string = body.playlist_id ?? "";
  let createdHere = false;
  const meId = (me.body as any)?.id;
  if (!playlistId) {
    const list = await call(token, "GET", "https://api.spotify.com/v1/me/playlists?limit=50");
    const items: any[] = (list.body as any)?.items ?? [];
    const owned = items.filter((p) => p?.owner?.id === meId);
    const pick = owned.find((p) => (p?.tracks?.total ?? 0) > 0) ?? owned[0];
    if (pick) { playlistId = pick.id; out.pick_existing = { id: pick.id, name: pick.name, total: pick?.tracks?.total }; }
    else {
      const c = await call(token, "POST", "https://api.spotify.com/v1/me/playlists", { name: `app01-audit ${Date.now()}`, public: false });
      playlistId = (c.body as any)?.id; createdHere = !!playlistId; out.create = c;
    }
  }
  out.playlist_id = playlistId;
  if (!playlistId) return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  out.step2_get_playlist = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}`);
  out.step3_get_tracks = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=10`);
  out.step4_post_tracks = await call(token, "POST", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`, { uris: [trackUri] });
  out.step5_delete_tracks = await call(token, "DELETE", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`, { tracks: [{ uri: trackUri }] });

  // Bonus: também testar /items pra App 01 (compatibilidade cruzada)
  out.step6_get_items = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=10`);
  out.step7_post_items = await call(token, "POST", `https://api.spotify.com/v1/playlists/${playlistId}/items`, { uris: [trackUri] });

  out.summary = {
    get_me: (out.step1_get_me as any).http_status,
    get_playlist: (out.step2_get_playlist as any).http_status,
    get_tracks: (out.step3_get_tracks as any).http_status,
    post_tracks: (out.step4_post_tracks as any).http_status,
    delete_tracks: (out.step5_delete_tracks as any).http_status,
    get_items_bonus: (out.step6_get_items as any).http_status,
    post_items_bonus: (out.step7_post_items as any).http_status,
  };

  const s = out.summary as any;
  out.verdict = (s.get_tracks === 200 && s.post_tracks >= 200 && s.post_tracks < 300 && s.delete_tracks === 200)
    ? "CENARIO_A — App 01 acessa /tracks legado (App 01 tem permissão diferente dos Apps 05–08)"
    : (s.get_tracks === 403 && s.post_tracks === 403 && s.delete_tracks === 403)
    ? "CENARIO_B — App 01 também 403: política global de descontinuação do /tracks"
    : "MIXED";

  if (createdHere && (body.cleanup !== false)) {
    out.cleanup = await call(token, "DELETE", `https://api.spotify.com/v1/playlists/${playlistId}/followers`);
  }

  return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
