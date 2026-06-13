// One-off raw test: POST /v1/me/playlists for a given (app_id, spotify_user_id).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { refreshUserToken, type SpotifyUserToken } from "../_shared/spotify-client.ts";
import { spotifyFetch } from "../_shared/spotify-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function getValidToken(row: SpotifyUserToken): Promise<string> {
  if (new Date(row.expires_at).getTime() > Date.now() + 60_000) return row.access_token;
  return await refreshUserToken(row);
}

async function call(token: string, method: string, url: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await spotifyFetch(url, init, { functionName: "spotify-me-playlist-test", operation: "me_playlist_test" });
  const txt = await r.text();
  let parsed: unknown = txt;
  try { parsed = txt ? JSON.parse(txt) : null; } catch { /* */ }
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  return {
    url, method, request_body: body ?? null,
    http_status: r.status,
    spotify_request_id: r.headers.get("x-spotify-request-id") ?? r.headers.get("x-request-id"),
    response_headers: headers,
    ok: r.ok,
    body_preview: parsed,
    raw_body: txt,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json() as { owners: { app_id: string; spotify_user_id: string }[] };

  const results = [];
  for (const o of body.owners) {
    const { data } = await sb.from("spotify_user_tokens").select("*")
      .eq("app_id", o.app_id).eq("spotify_user_id", o.spotify_user_id).maybeSingle();
    if (!data) { results.push({ owner: o, error: "token not found" }); continue; }
    const row = data as SpotifyUserToken;
    let token: string;
    try { token = await getValidToken(row); }
    catch (e) { results.push({ owner: o, error: `refresh failed: ${(e as Error).message}` }); continue; }

    const me1 = await call(token, "GET", "https://api.spotify.com/v1/me");
    const post = await call(token, "POST", "https://api.spotify.com/v1/me/playlists",
      { name: "__nex_test_me_playlist", public: false });
    const me2 = await call(token, "GET", "https://api.spotify.com/v1/me");

    // cleanup if created
    let cleanup = null;
    const createdId = (post.body_preview as { id?: string } | null)?.id;
    if (post.ok && createdId) {
      cleanup = await call(token, "DELETE",
        `https://api.spotify.com/v1/playlists/${createdId}/followers`);
    }

    results.push({
      owner: o,
      display_name: row.display_name,
      token_owner_id_in_db: row.spotify_user_id,
      me_before: me1,
      post_me_playlists: post,
      me_after: me2,
      me_id_matches_token: (me1.body_preview as { id?: string } | null)?.id === row.spotify_user_id,
      cleanup,
    });
  }
  return new Response(JSON.stringify({ ok: true, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
