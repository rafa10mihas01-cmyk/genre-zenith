// spotify-items-audit — compara endpoints legados /tracks vs modernos /items
// Body: { spotify_user_id?, app_id?, playlist_id?, test_track_uri?, cleanup? }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_05_ID = "821cb0cc-001b-4d2f-a0c0-66cafe055e72";
const DEFAULT_USER = "31svfjqrk6nayh5d46kmffemqyhy";
const DEFAULT_TRACK = "spotify:track:11dFghVXANMlKmJXsNCbNl";
const FIELDS = "tracks.total,tracks.items(added_at,added_by.id,track(id,name,uri,duration_ms,artists(name),album(name,images)))";

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
    access_token: j.access_token,
    expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
    refresh_token: j.refresh_token ?? row.refresh_token,
  }).eq("id", row.id);
  return j.access_token;
}

async function call(token: string, method: string, url: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let parsed: any = txt;
  try { parsed = txt ? JSON.parse(txt) : null; } catch { /* */ }
  return {
    method, url,
    http_status: r.status,
    ok: r.ok,
    spotify_request_id: r.headers.get("x-spotify-request-id"),
    body: parsed,
  };
}

function schemaCheck(item: any) {
  const t = item?.track ?? {};
  return {
    "added_at": item?.added_at != null,
    "added_by.id": item?.added_by?.id != null,
    "track.id": t.id != null,
    "track.uri": t.uri != null,
    "track.name": t.name != null,
    "track.duration_ms": t.duration_ms != null,
    "track.artists[].name": Array.isArray(t.artists) && t.artists[0]?.name != null,
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

  const { data: tokens } = await sb.from("spotify_user_tokens").select("*")
    .eq("spotify_user_id", uid).eq("app_id", appId)
    .order("updated_at", { ascending: false }).limit(1);
  if (!tokens?.length) return new Response(JSON.stringify({ error: "no token" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const row = tokens[0];
  const token = await refreshIfNeeded(sb, row);
  const out: Record<string, unknown> = {
    token_meta: { app_id: row.app_id, spotify_user_id: row.spotify_user_id, display_name: row.display_name, scope: row.scope, updated_at: row.updated_at },
  };

  // Pick or create a playlist
  let playlistId: string = body.playlist_id ?? "";
  let createdHere = false;
  const me = await call(token, "GET", "https://api.spotify.com/v1/me");
  const meId = (me.body as any)?.id;
  out.me = { http_status: me.http_status, id: meId };

  if (!playlistId) {
    const list = await call(token, "GET", "https://api.spotify.com/v1/me/playlists?limit=50");
    const items: any[] = (list.body as any)?.items ?? [];
    const owned = items.filter((p) => p?.owner?.id === meId);
    const pick = owned.find((p) => (p?.tracks?.total ?? 0) > 0) ?? owned[0];
    if (pick) {
      playlistId = pick.id;
      out.pick_existing = { id: pick.id, name: pick.name, total: pick?.tracks?.total };
    } else {
      const c = await call(token, "POST", "https://api.spotify.com/v1/me/playlists", { name: `items-audit ${new Date().toISOString()}`, public: false });
      playlistId = (c.body as any)?.id;
      createdHere = !!playlistId;
      out.create = { http_status: c.http_status, id: playlistId };
      if (playlistId) {
        const seed = await call(token, "POST", `https://api.spotify.com/v1/playlists/${playlistId}/items`, { uris: [trackUri] });
        out.seed_via_items = { http_status: seed.http_status, body: seed.body };
        if (!seed.ok) {
          const seed2 = await call(token, "POST", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`, { uris: [trackUri] });
          out.seed_via_tracks = { http_status: seed2.http_status, body: seed2.body };
        }
      }
    }
  }
  out.playlist_id = playlistId;
  if (!playlistId) return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // 1. GET /playlists/{id} bare
  const t1 = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}`);
  const t1b = t1.body as any;
  out.test1_get_bare = {
    http_status: t1.http_status,
    spotify_request_id: t1.spotify_request_id,
    has_tracks_key: t1b?.tracks !== undefined,
    tracks_total: t1b?.tracks?.total,
    tracks_items_len: t1b?.tracks?.items?.length ?? null,
    first_item_schema: t1b?.tracks?.items?.[0] ? schemaCheck(t1b.tracks.items[0]) : null,
    first_item_raw: t1b?.tracks?.items?.[0] ?? null,
  };

  // 2. GET /playlists/{id}?fields=...
  const t2 = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}?fields=${encodeURIComponent(FIELDS)}`);
  const t2b = t2.body as any;
  const t2items: any[] = t2b?.tracks?.items ?? [];
  out.test2_get_fields = {
    http_status: t2.http_status,
    spotify_request_id: t2.spotify_request_id,
    has_tracks_key: t2b?.tracks !== undefined,
    tracks_total: t2b?.tracks?.total,
    tracks_items_len: t2items.length,
    first_item_schema: t2items[0] ? schemaCheck(t2items[0]) : null,
    full_body: t2b,
  };

  // 3. Legacy GET /tracks
  const t3 = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=10`);
  out.test3_legacy_get_tracks = {
    http_status: t3.http_status,
    spotify_request_id: t3.spotify_request_id,
    items_len: (t3.body as any)?.items?.length ?? null,
    body: t3.body,
  };

  // 4. Modern GET /items
  const t4 = await call(token, "GET", `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=10`);
  out.test4_modern_get_items = {
    http_status: t4.http_status,
    spotify_request_id: t4.spotify_request_id,
    items_len: (t4.body as any)?.items?.length ?? null,
    body: t4.body,
  };

  // 5. POST /items (write)
  const t5 = await call(token, "POST", `https://api.spotify.com/v1/playlists/${playlistId}/items`, { uris: [trackUri] });
  out.test5_post_items = { http_status: t5.http_status, spotify_request_id: t5.spotify_request_id, body: t5.body };

  // 6. POST /tracks (legacy write)
  const t6 = await call(token, "POST", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`, { uris: [trackUri] });
  out.test6_post_tracks_legacy = { http_status: t6.http_status, spotify_request_id: t6.spotify_request_id, body: t6.body };

  // 7. DELETE /items
  const t7 = await call(token, "DELETE", `https://api.spotify.com/v1/playlists/${playlistId}/items`, { tracks: [{ uri: trackUri }] });
  out.test7_delete_items = { http_status: t7.http_status, spotify_request_id: t7.spotify_request_id, body: t7.body };

  // 8. DELETE /tracks (legacy)
  const t8 = await call(token, "DELETE", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`, { tracks: [{ uri: trackUri }] });
  out.test8_delete_tracks_legacy = { http_status: t8.http_status, spotify_request_id: t8.spotify_request_id, body: t8.body };

  // 9. PUT reorder via /items
  const t9 = await call(token, "PUT", `https://api.spotify.com/v1/playlists/${playlistId}/items`, { range_start: 0, insert_before: 1, range_length: 1 });
  out.test9_put_reorder_items = { http_status: t9.http_status, spotify_request_id: t9.spotify_request_id, body: t9.body };

  // 10. PUT reorder via /tracks (legacy)
  const t10 = await call(token, "PUT", `https://api.spotify.com/v1/playlists/${playlistId}/tracks`, { range_start: 0, insert_before: 1, range_length: 1 });
  out.test10_put_reorder_tracks_legacy = { http_status: t10.http_status, spotify_request_id: t10.spotify_request_id, body: t10.body };

  // Summary
  out.summary = {
    bare_get_has_items: (t1.body as any)?.tracks?.items?.length ?? 0,
    fields_get_has_items: t2items.length,
    legacy_get_tracks: t3.http_status,
    modern_get_items: t4.http_status,
    post_items: t5.http_status,
    post_tracks_legacy: t6.http_status,
    delete_items: t7.http_status,
    delete_tracks_legacy: t8.http_status,
    put_reorder_items: t9.http_status,
    put_reorder_tracks_legacy: t10.http_status,
  };

  out.verdict = (() => {
    const modernReads = t4.http_status === 200 || t2items.length > 0 || ((t1.body as any)?.tracks?.items?.length ?? 0) > 0;
    const modernWrites = t5.http_status >= 200 && t5.http_status < 300;
    const legacyBlocked = t3.http_status === 403 && t6.http_status === 403;
    if (modernReads && modernWrites && legacyBlocked) return "LEGACY_ONLY_BLOCKED — migrar para /items resolve";
    if (!modernReads && !modernWrites) return "ALL_BLOCKED — restrição não é por endpoint";
    if (modernReads && !modernWrites) return "READS_OK_WRITES_BLOCKED";
    return "MIXED — inspecionar status individuais";
  })();

  // Schema mapping vs internal consumers
  out.schema_expected_by_consumers = {
    listPlaylistTracksRich: ["items[].added_at", "items[].track.id", "items[].track.name", "items[].track.duration_ms", "items[].track.artists[].name", "items[].track.album.images"],
    playlist_tracks_list_fields: "items(added_at,track(id,name,duration_ms,artists(name),album(images))),next",
    note: "Ambos esperam shape de /tracks (root.items[]). Em /items o shape é idêntico. Em GET /playlists/{id}?fields=... o shape vem aninhado em tracks.items[].",
  };

  if (createdHere && cleanup) {
    out.cleanup = await call(token, "DELETE", `https://api.spotify.com/v1/playlists/${playlistId}/followers`);
  }

  return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
