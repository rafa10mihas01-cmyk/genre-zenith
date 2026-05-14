// import-managed-playlist — importa metadata pública de uma playlist Spotify
// e registra em managed_playlists. Tudo manual: 1 URL → 1 botão → 1 import.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getSpotifyToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLAYLIST_RE = /spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([A-Za-z0-9]+)/i;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const url: string = (body?.url ?? "").toString().trim();
    const genreId: string | null = body?.genre_id ?? null;
    if (!url) return jr({ ok: false, error: "url obrigatória" }, 400);

    const m = url.match(PLAYLIST_RE);
    if (!m) return jr({ ok: false, error: "URL precisa ser de uma playlist do Spotify" }, 400);
    const playlistId = m[1];

    // Busca metadata RICA via Spotify Web API (followers + tracks_count + name + cover)
    let name = `Playlist ${playlistId}`;
    let cover_url: string | null = null;
    let followers = 0;
    let tracks_count = 0;
    let description: string | null = null;
    try {
      const token = await getSpotifyToken();
      const r = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,description,images,followers(total),tracks(total)`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (r.ok) {
        const j = await r.json();
        name = j?.name ?? name;
        cover_url = Array.isArray(j?.images) && j.images[0]?.url ? j.images[0].url : null;
        followers = j?.followers?.total ?? 0;
        tracks_count = j?.tracks?.total ?? 0;
        description = j?.description ?? null;
      }
    } catch (_e) { /* fallback abaixo */ }

    // Fallback oEmbed se Spotify falhou (ex: 404)
    if (!cover_url) {
      const metaRes = await fetch(`${SUPABASE_URL}/functions/v1/fetch-spotify-meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ url }),
      });
      const meta = await metaRes.json().catch(() => ({}));
      if (meta?.title) name = meta.title;
      cover_url = meta?.thumbnail_url ?? null;
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await supabase
      .from("managed_playlists")
      .upsert({
        spotify_playlist_id: playlistId,
        spotify_url: `https://open.spotify.com/playlist/${playlistId}`,
        name,
        cover_url,
        followers,
        tracks_count,
        description,
        genre_id: genreId,
        last_metrics_at: new Date().toISOString(),
        imported_by: guard.via === "user" ? guard.userId : null,
        metadata: { source: "import-managed-playlist" },
      }, { onConflict: "spotify_playlist_id" })
      .select()
      .single();

    if (error) return jr({ ok: false, error: error.message }, 500);
    return jr({ ok: true, playlist: data });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
