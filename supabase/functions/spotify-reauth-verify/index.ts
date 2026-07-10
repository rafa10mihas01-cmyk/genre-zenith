// spotify-reauth-verify — Final test after re-OAuth.
// Uses the latest token row for a given spotify_user_id (optionally filtered by app_id)
// and runs the 3 definitive calls: GET /me, POST add track, GET /playlists/{id}/tracks.
// Body: { spotify_user_id: string, app_id?: string, test_track_uri?: string }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_APP_SLUG = "nexengine-10";
const DEFAULT_TRACK = "spotify:track:11dFghVXANMlKmJXsNCbNl"; // Cut To The Feeling


async function refreshIfNeeded(sb: ReturnType<typeof createClient>, row: any): Promise<string> {
  if (new Date(row.expires_at).getTime() > Date.now() + 60_000) return row.access_token;
  const { data: app } = await sb.from("spotify_apps").select("client_id, client_secret").eq("id", row.app_id).maybeSingle();
  if (!app) throw new Error(`app ${row.app_id} not found`);
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${app.client_id}:${app.client_secret}`) },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`refresh ${r.status}: ${JSON.stringify(j)}`);
  const newToken = j.access_token as string;
  await sb.from("spotify_user_tokens").update({
    access_token: newToken,
    expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
    refresh_token: j.refresh_token ?? row.refresh_token,
  }).eq("id", row.id);
  return newToken;
}

async function call(token: string, method: string, url: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let parsed: unknown = txt;
  try { parsed = txt ? JSON.parse(txt) : null; } catch { /* */ }
  return {
    method, url,
    http_status: r.status,
    ok: r.ok,
    spotify_request_id: r.headers.get("x-spotify-request-id") ?? r.headers.get("x-request-id"),
    retry_after: r.headers.get("retry-after"),
    body: typeof parsed === "string" ? parsed.slice(0, 500) : parsed,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: { spotify_user_id?: string; app_id?: string; test_track_uri?: string; playlist_id?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const uid = body.spotify_user_id;
  if (!uid) {
    return new Response(JSON.stringify({ error: "spotify_user_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  let appId = body.app_id ?? null;
  if (!appId) {
    const { data: app } = await sb.from("spotify_apps").select("id").eq("slug", DEFAULT_APP_SLUG).maybeSingle();
    appId = app?.id ?? null;
    if (!appId) return new Response(JSON.stringify({ error: `app slug ${DEFAULT_APP_SLUG} not found` }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const trackUri = body.test_track_uri ?? DEFAULT_TRACK;

  const { data: tokens, error } = await sb.from("spotify_user_tokens")
    .select("*").eq("spotify_user_id", uid).eq("app_id", appId)
    .order("updated_at", { ascending: false }).limit(1);
  if (error || !tokens?.length) {
    return new Response(JSON.stringify({ error: "no token row", details: error?.message }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const row = tokens[0];
  const steps: Record<string, unknown> = {
    token_meta: {
      token_id: row.id,
      app_id: row.app_id,
      spotify_user_id: row.spotify_user_id,
      display_name: row.display_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
      expires_at: row.expires_at,
      scope: row.scope,
    },
  };

  let token: string;
  try { token = await refreshIfNeeded(sb, row); }
  catch (e) {
    steps.refresh_error = String(e);
    return new Response(JSON.stringify(steps, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // 1) GET /me
  steps.step1_me = await call(token, "GET", "https://api.spotify.com/v1/me");

  // 2) Create sandbox playlist (owned by this user)
  const me = steps.step1_me as { body?: { id?: string } };
  const meId = me?.body?.id;
  let playlistId = body.playlist_id ?? null;
  let createdHere = false;
  if (!playlistId && meId) {
    const created = await call(token, "POST", `https://api.spotify.com/v1/users/${meId}/playlists`, {
      name: `reauth-verify ${new Date().toISOString()}`, public: false, description: "diagnostic" });
    steps.step2_create = created;
    playlistId = (created.body as { id?: string } | null)?.id ?? null;
    createdHere = !!playlistId;
  }
  steps.playlist_id = playlistId;

  if (playlistId) {
    // 3) GET playlist meta
    steps.step3_get_playlist = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}?fields=id,name,owner,collaborative,public,tracks.total`);

    // 4) POST add track
    steps.step4_add_track = await call(token, "POST", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`, { uris: [trackUri] });

    // 5) GET /tracks (the suspect)
    steps.step5_get_tracks = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=10`);

    // 6) Cleanup if we created
    if (createdHere) {
      steps.step6_cleanup = await call(token, "DELETE", `https://api.spotify.com/v1/playlists/${playlistId}/followers`);
    }
  }

  const verdict =
    (steps.step5_get_tracks as { http_status?: number } | undefined)?.http_status === 200
      ? "GET_TRACKS_OK_AFTER_REAUTH"
      : (steps.step5_get_tracks as { http_status?: number } | undefined)?.http_status === 403
      ? "STILL_403_AFTER_REAUTH"
      : "INCONCLUSIVE";
  steps.verdict = verdict;

  return new Response(JSON.stringify(steps, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
