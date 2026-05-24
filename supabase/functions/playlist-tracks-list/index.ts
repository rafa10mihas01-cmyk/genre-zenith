// playlist-tracks-list — lista faixas atuais de uma playlist via Spotify Web API.
// Body: { playlist_id: uuid }  (uuid de public.playlists)
// Retorna: { ok, tracks: [{ spotify_track_id, name, artists, album_cover, duration_ms, added_at }] }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpotifyToken } from "../_shared/spotify.ts";
import { listPlaylistTracksRich } from "../_shared/spotify-playlist.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: any;
  try { body = await req.json(); } catch { return jr({ error: "Invalid JSON" }, 400); }
  const playlist_id = String(body?.playlist_id ?? "").trim();
  if (!playlist_id) return jr({ error: "playlist_id obrigatório" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Aceita tanto playlists.id (canonical) quanto managed_playlists.id
  let spotifyPlaylistId: string | null = null;
  const { data: pl, error: plErr } = await supabase
    .from("playlists")
    .select("id, spotify_playlist_id")
    .eq("id", playlist_id)
    .maybeSingle();
  if (plErr) return jr({ ok: false, error: plErr.message }, 500);
  if (pl?.spotify_playlist_id) {
    spotifyPlaylistId = pl.spotify_playlist_id;
  } else {
    const { data: mp, error: mpErr } = await supabase
      .from("managed_playlists")
      .select("id, spotify_playlist_id")
      .eq("id", playlist_id)
      .maybeSingle();
    if (mpErr) return jr({ ok: false, error: mpErr.message }, 500);
    spotifyPlaylistId = mp?.spotify_playlist_id ?? null;
  }
  if (!spotifyPlaylistId) {
    return jr({
      ok: false,
      code: "playlist_not_found",
      error: "playlist não encontrada",
      tracks: [],
      total: 0,
    });
  }

  try {
    const token = await getSpotifyToken();
    const rich = await listPlaylistTracksRich(spotifyPlaylistId, token, {
      max: 10000,
      fields: "items(added_at,track(id,name,duration_ms,artists(name),album(images))),next",
    });
    const out = rich
      .filter((t) => t.spotify_track_id)
      .map((t) => ({
        spotify_track_id: t.spotify_track_id,
        name: t.name || "Unknown",
        artists: t.artists,
        album_cover: t.album_cover,
        duration_ms: t.duration_ms,
        added_at: t.added_at,
      }));
    return jr({ ok: true, tracks: out, total: out.length });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
