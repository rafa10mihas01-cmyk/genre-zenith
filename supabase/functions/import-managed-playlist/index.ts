// import-managed-playlist — importa metadata pública de uma playlist Spotify
// e registra em managed_playlists. Tudo manual: 1 URL → 1 botão → 1 import.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getAppToken } from "../_shared/spotify-client.ts";
import { getPlaylistMeta } from "../_shared/spotify-playlist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLAYLIST_RE = /spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([A-Za-z0-9]+)/i;

// Onboarding: playlists novas com saves < AUTO_ARCHIVE_MIN_FOLLOWERS nascem arquivadas.
// Exceções: metadata.strategic === true, metadata.auto_archive_exempt === true, locked_at IS NOT NULL.
// Reativação é sempre manual via UI.
const AUTO_ARCHIVE_MIN_FOLLOWERS = 100;

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
      const token = await getAppToken();
      const meta = await getPlaylistMeta(playlistId, token, {
        fields: "name,description,images,followers(total),tracks(total)",
      });
      name = meta.name || name;
      cover_url = meta.cover_url;
      followers = meta.followers;
      tracks_count = meta.tracks_total;
      description = meta.description;
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
    const now = new Date().toISOString();
    const { data: canonical, error: canonicalError } = await supabase
      .from("playlists")
      .upsert({
        spotify_playlist_id: playlistId,
        name,
        ownership: "own",
        account_id: null,
        source: "managed",
        followers,
        cover_url,
        genre_id: genreId,
        monitored: true,
        last_seen_at: now,
      }, { onConflict: "spotify_playlist_id" })
      .select("id")
      .single();
    if (canonicalError) return jr({ ok: false, error: canonicalError.message }, 500);

    // Verifica se já existe (pra decidir se aplica auto-arquivamento de onboarding e
    // pra não clobber archived_at/metadata em re-imports).
    const { data: existing } = await supabase
      .from("managed_playlists")
      .select("id, archived_at, metadata, locked_at")
      .eq("spotify_playlist_id", playlistId)
      .maybeSingle();

    const isNew = !existing;
    const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
    const isExempt =
      existingMeta.strategic === true ||
      existingMeta.auto_archive_exempt === true ||
      !!existing?.locked_at;
    const shouldAutoArchive =
      isNew && followers < AUTO_ARCHIVE_MIN_FOLLOWERS && !isExempt;

    const payload: Record<string, unknown> = {
      spotify_playlist_id: playlistId,
      spotify_url: `https://open.spotify.com/playlist/${playlistId}`,
      name,
      cover_url,
      followers,
      tracks_count,
      description,
      genre_id: genreId,
      canonical_playlist_id: canonical.id,
      last_metrics_at: now,
      imported_by: guard.via === "user" ? guard.userId : null,
      metadata: { source: "import-managed-playlist" },
    };
    if (shouldAutoArchive) {
      payload.archived_at = now;
      payload.archived_reason = "auto_onboarding_low_followers";
      payload.archived_followers = followers;
    }

    const { data, error } = await supabase
      .from("managed_playlists")
      .upsert(payload, { onConflict: "spotify_playlist_id" })
      .select()
      .single();

    if (error) return jr({ ok: false, error: error.message }, 500);
    return jr({ ok: true, playlist: data, auto_archived: shouldAutoArchive });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
