// Forensic investigation of /v1/playlists/{id}/tracks 403
// Body: { app_id, spotify_user_id, existing_playlist_id? }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { refreshUserToken, type SpotifyUserToken } from "../_shared/spotify.ts";
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
  const t0 = Date.now();
  const r = await spotifyFetch(url, init, { functionName: "spotify-tracks-forensics", operation: "forensics_call" });
  const txt = await r.text();
  let parsed: unknown = txt;
  try { parsed = txt ? JSON.parse(txt) : null; } catch { /* */ }
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  return {
    url, method,
    request_headers_sent: { Authorization: "Bearer <redacted>", "Content-Type": "application/json" },
    request_body: body ?? null,
    http_status: r.status,
    ok: r.ok,
    duration_ms: Date.now() - t0,
    spotify_request_id: r.headers.get("x-spotify-request-id") ?? r.headers.get("x-request-id"),
    response_headers: headers,
    body_preview: parsed,
    raw_body: txt,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json() as { app_id: string; spotify_user_id: string; existing_playlist_id?: string };

  const { data } = await sb.from("spotify_user_tokens").select("*")
    .eq("app_id", body.app_id).eq("spotify_user_id", body.spotify_user_id).maybeSingle();
  if (!data) return new Response(JSON.stringify({ error: "token not found" }), { status: 404 });
  const row = data as SpotifyUserToken;
  const token = await getValidToken(row);

  const out: Record<string, unknown> = {
    owner: { app_id: body.app_id, spotify_user_id: body.spotify_user_id, display_name: row.display_name },
  };

  // TESTE A — Criar playlist e ler
  const create = await call(token, "POST", "https://api.spotify.com/v1/me/playlists",
    { name: `__nex_forensics_${Date.now()}`, public: false, collaborative: false });
  const newId = (create.body_preview as { id?: string } | null)?.id ?? null;

  const getPl = newId ? await call(token, "GET", `https://api.spotify.com/v1/playlists/${newId}`) : null;
  const getTracksNew = newId ? await call(token, "GET", `https://api.spotify.com/v1/playlists/${newId}/tracks`) : null;

  out.A_new_playlist = {
    create,
    playlist_id: newId,
    owner_in_playlist: (getPl?.body_preview as { owner?: { id?: string } } | null)?.owner?.id ?? null,
    public: (getPl?.body_preview as { public?: boolean } | null)?.public ?? null,
    collaborative: (getPl?.body_preview as { collaborative?: boolean } | null)?.collaborative ?? null,
    snapshot_id: (getPl?.body_preview as { snapshot_id?: string } | null)?.snapshot_id ?? null,
    get_playlist: getPl,
    get_tracks: getTracksNew,
  };

  // TESTE B — Listar /me/playlists e checar se o novo aparece
  const mePls = await call(token, "GET", "https://api.spotify.com/v1/me/playlists?limit=50");
  const items = (mePls.body_preview as { items?: Array<{ id: string; name: string }> } | null)?.items ?? [];
  const appears = newId ? items.some((p) => p.id === newId) : false;
  const retryTracks = (appears && newId)
    ? await call(token, "GET", `https://api.spotify.com/v1/playlists/${newId}/tracks`)
    : null;
  out.B_appears_in_catalog = {
    me_playlists_status: mePls.http_status,
    total_returned: items.length,
    new_playlist_appears: appears,
    retry_get_tracks: retryTracks,
  };

  // TESTE C — Playlist antiga do mesmo owner
  let oldPlaylistId = body.existing_playlist_id ?? null;
  if (!oldPlaylistId) {
    // pega a primeira playlist do /me/playlists que NÃO seja a recém criada
    const candidate = items.find((p) => p.id !== newId);
    oldPlaylistId = candidate?.id ?? null;
  }
  out.C_existing_playlist = oldPlaylistId ? {
    playlist_id: oldPlaylistId,
    get_playlist: await call(token, "GET", `https://api.spotify.com/v1/playlists/${oldPlaylistId}`),
    get_tracks: await call(token, "GET", `https://api.spotify.com/v1/playlists/${oldPlaylistId}/tracks`),
  } : { error: "no existing playlist found" };

  // TESTE D — Playlist pública famosa (Today's Top Hits)
  const famous = "37i9dQZF1DXcBWIGoYBM5M";
  out.D_famous_public = {
    playlist_id: famous,
    get_playlist: await call(token, "GET", `https://api.spotify.com/v1/playlists/${famous}`),
    get_tracks: await call(token, "GET", `https://api.spotify.com/v1/playlists/${famous}/tracks`),
  };

  // TESTE E — Endpoint alternativo: fields=tracks
  if (newId) {
    out.E_fields_alternative = {
      get_playlist_fields: await call(token, "GET",
        `https://api.spotify.com/v1/playlists/${newId}?fields=id,name,tracks.total,tracks.items(track(id,name))`),
      get_tracks_endpoint: await call(token, "GET",
        `https://api.spotify.com/v1/playlists/${newId}/tracks`),
    };
  }

  // TESTE F — Já está nos response_headers de cada chamada acima

  // Cleanup
  if (newId) {
    out.cleanup = await call(token, "DELETE", `https://api.spotify.com/v1/playlists/${newId}/followers`);
  }

  // Resumo comparativo
  const summary = {
    A_new_get_tracks: (out.A_new_playlist as any)?.get_tracks?.http_status,
    B_retry_after_catalog: (out.B_appears_in_catalog as any)?.retry_get_tracks?.http_status ?? "n/a",
    C_existing_get_tracks: (out.C_existing_playlist as any)?.get_tracks?.http_status ?? "n/a",
    D_famous_get_tracks: (out.D_famous_public as any)?.get_tracks?.http_status,
    E_fields_alternative: (out.E_fields_alternative as any)?.get_playlist_fields?.http_status ?? "n/a",
    create_works: (out.A_new_playlist as any)?.create?.http_status,
  };
  out.summary = summary;

  return new Response(JSON.stringify({ ok: true, ...out }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
