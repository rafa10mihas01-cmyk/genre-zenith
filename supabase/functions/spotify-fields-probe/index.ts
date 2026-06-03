// spotify-fields-probe — Compara GET /playlists/{id}?fields=... vs GET /playlists/{id}/tracks
// usando uma playlist do próprio owner no App 05.
// Body: { spotify_user_id?: string, app_id?: string, playlist_id?: string, test_track_uri?: string, cleanup?: boolean }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_05_ID = "821cb0cc-001b-4d2f-a0c0-66cafe055e72";
const DEFAULT_USER = "31svfjqrk6nayh5d46kmffemqyhy"; // Sul
const DEFAULT_TRACK = "spotify:track:11dFghVXANMlKmJXsNCbNl";

const FIELDS = "id,name,tracks.total,tracks.items(added_at,added_by.id,track(id,name,uri,duration_ms,artists(name),album(name,images)))";

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
  if (!r.ok) throw new Error(`refresh ${r.status}`);
  await sb.from("spotify_user_tokens").update({
    access_token: j.access_token, expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
    refresh_token: j.refresh_token ?? row.refresh_token,
  }).eq("id", row.id);
  return j.access_token;
}

async function call(token: string, method: string, url: string, body?: unknown) {
  const r = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let parsed: any = txt;
  try { parsed = txt ? JSON.parse(txt) : null; } catch { /* */ }
  return { method, url, http_status: r.status, ok: r.ok, spotify_request_id: r.headers.get("x-spotify-request-id"), body: parsed };
}

function checkFields(item: any): Record<string, boolean> {
  const t = item?.track ?? {};
  return {
    "added_at": item?.added_at != null,
    "added_by.id": item?.added_by?.id != null,
    "track.id": t.id != null,
    "track.uri": t.uri != null,
    "track.name": t.name != null,
    "track.duration_ms": t.duration_ms != null,
    "track.artists[].name": Array.isArray(t.artists) && t.artists.length > 0 && t.artists[0]?.name != null,
    "track.album.name": t.album?.name != null,
    "track.album.images": Array.isArray(t.album?.images) && t.album.images.length > 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const uid = body.spotify_user_id ?? DEFAULT_USER;
  const appId = body.app_id ?? APP_05_ID;
  const trackUri = body.test_track_uri ?? DEFAULT_TRACK;
  const cleanup = body.cleanup !== false;

  const { data: tokens } = await sb.from("spotify_user_tokens").select("*").eq("spotify_user_id", uid).eq("app_id", appId).order("updated_at", { ascending: false }).limit(1);
  if (!tokens?.length) {
    return new Response(JSON.stringify({ error: "no token" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const row = tokens[0];
  const out: Record<string, unknown> = {
    token_meta: { token_id: row.id, app_id: row.app_id, spotify_user_id: row.spotify_user_id, display_name: row.display_name, updated_at: row.updated_at, scope: row.scope },
  };
  const token = await refreshIfNeeded(sb, row);

  // Setup playlist
  let playlistId: string = body.playlist_id ?? "";
  let createdHere = false;
  if (!playlistId) {
    const me = await call(token, "GET", "https://api.spotify.com/v1/me");
    const meId = (me.body as any)?.id;
    out.step_me = { http_status: me.http_status, id: meId };
    if (!meId) return new Response(JSON.stringify({ ...out, error: "me failed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const created = await call(token, "POST", `https://api.spotify.com/v1/me/playlists`, { name: `fields-probe ${new Date().toISOString()}`, public: false });
    out.step_create = { http_status: created.http_status, id: (created.body as any)?.id };
    playlistId = (created.body as any)?.id;
    createdHere = !!playlistId;
    if (!playlistId) return new Response(JSON.stringify({ ...out, error: "create failed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const add = await call(token, "POST", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`, { uris: [trackUri] });
    out.step_add = { http_status: add.http_status, snapshot_id: (add.body as any)?.snapshot_id };
  }
  out.playlist_id = playlistId;

  // Test 1: bare GET /playlists/{id}
  const t1 = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}`);
  out.test1_get_playlist_bare = { http_status: t1.http_status, name: (t1.body as any)?.name, tracks_total: (t1.body as any)?.tracks?.total, tracks_items_len: (t1.body as any)?.tracks?.items?.length ?? null };

  // Test 2: GET /playlists/{id}?fields=...
  const t2 = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}?fields=${encodeURIComponent(FIELDS)}`);
  const t2body = t2.body as any;
  const t2items: any[] = t2body?.tracks?.items ?? [];
  out.test2_get_playlist_with_fields = {
    http_status: t2.http_status,
    spotify_request_id: t2.spotify_request_id,
    tracks_total: t2body?.tracks?.total,
    tracks_items_len: t2items.length,
    first_item_fields_present: t2items[0] ? checkFields(t2items[0]) : null,
    full_body: t2body,
  };

  // Test 3: GET /playlists/{id}/tracks (the suspect)
  const t3 = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=10`);
  const t3body = t3.body as any;
  const t3items: any[] = t3body?.items ?? [];
  out.test3_get_tracks_endpoint = {
    http_status: t3.http_status,
    spotify_request_id: t3.spotify_request_id,
    items_len: t3items.length,
    first_item_fields_present: t3items[0] ? checkFields(t3items[0]) : null,
    full_body: t3body,
  };

  // Diff
  out.field_comparison = {
    t2_has_items: t2items.length > 0,
    t3_has_items: t3items.length > 0,
    t2_first_item_fields: t2items[0] ? checkFields(t2items[0]) : null,
    t3_first_item_fields: t3items[0] ? checkFields(t3items[0]) : null,
  };

  out.verdict =
    t2items.length > 0 && t3.http_status === 403
      ? "FALLBACK_VIABLE: /playlists/{id}?fields=... returns items, /tracks endpoint is the only blocked one"
      : t2items.length > 0 && t3items.length > 0
      ? "BOTH_WORK"
      : t2items.length === 0
      ? "FALLBACK_BROKEN_TOO"
      : "INCONCLUSIVE";

  if (createdHere && cleanup) {
    out.step_cleanup = await call(token, "DELETE", `https://api.spotify.com/v1/playlists/${playlistId}/followers`);
  }

  return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
