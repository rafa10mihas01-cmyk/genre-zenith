// managed-tracks-writer — escrita canônica em managed_playlist_tracks
// usada pelo catalog-executor após uma operação real no Spotify
// (INSERT ou REMOVE) ter retornado sucesso.
//
// Reutiliza o mesmo formato de linha que sync-managed-playlist-tracks
// usa quando faz reconciliação (colunas: playlist_id, spotify_track_id,
// track_name, artist_name, album_cover, position, added_at, duration_ms,
// isrc). O sync continua existindo apenas como reconciliador periódico
// (followers, tracks_count corretivo, remoções manuais, posições).
//
// Regras:
//   - Em INSERT: posição = (max(position) atual) + 1 (Spotify append).
//   - Em REMOVE: deleta a linha. Reordenação fina fica pro sync.
//   - Em ambos: tracks_count é recalculado e tracks_hash é invalidado
//     (set NULL) para forçar o próximo sync a recalcular o delta real.
//   - Metadados (nome, artistas, capa, isrc, duração) vêm do
//     `spotify_track_cache` (+ `spotify_artist_cache`). Fallback final
//     pega de `catalog_tracks`. Nunca abre HTTP pra Spotify aqui — se
//     metadado estiver vazio, grava NULL e o sync corrige na próxima.

import { getArtistCacheBatch, getTrackCacheBatch } from "./spotify-cache.ts";

type SB = any;

async function loadTrackMetadata(
  sb: SB,
  spotifyTrackId: string,
): Promise<{
  track_name: string | null;
  artist_name: string | null;
  album_cover: string | null;
  duration_ms: number | null;
  isrc: string | null;
}> {
  const fallback = {
    track_name: null as string | null,
    artist_name: null as string | null,
    album_cover: null as string | null,
    duration_ms: null as number | null,
    isrc: null as string | null,
  };

  try {
    const cache = await getTrackCacheBatch([spotifyTrackId]);
    const row = cache.get(spotifyTrackId);
    if (row) {
      const raw: any = (row as any).raw ?? {};
      let cover: string | null =
        Array.isArray(raw?.album?.images) && raw.album.images[0]?.url ? raw.album.images[0].url : null;
      let artistName: string | null =
        Array.isArray(raw?.artists) && raw.artists.length > 0
          ? raw.artists.map((a: any) => a?.name).filter(Boolean).join(", ") || null
          : null;
      if (!artistName && Array.isArray((row as any).artist_ids) && (row as any).artist_ids.length) {
        const art = await getArtistCacheBatch((row as any).artist_ids);
        artistName = (row as any).artist_ids
          .map((id: string) => art.get(id)?.name)
          .filter(Boolean)
          .join(", ") || null;
      }
      fallback.track_name = (row as any).name ?? null;
      fallback.artist_name = artistName;
      fallback.album_cover = cover;
      fallback.duration_ms = (row as any).duration_ms ?? null;
      fallback.isrc = (row as any).isrc ?? null;
      if (fallback.track_name || fallback.artist_name) return fallback;
    }
  } catch {
    /* cache best-effort */
  }

  // Fallback final: catalog_tracks tem o essencial pra distribuição.
  try {
    const { data } = await sb
      .from("catalog_tracks")
      .select("track_name, artist_name, cover_url, duration_ms, isrc")
      .eq("spotify_track_id", spotifyTrackId)
      .maybeSingle();
    if (data) {
      fallback.track_name ||= data.track_name ?? null;
      fallback.artist_name ||= data.artist_name ?? null;
      fallback.album_cover ||= data.cover_url ?? null;
      fallback.duration_ms ||= data.duration_ms ?? null;
      fallback.isrc ||= data.isrc ?? null;
    }
  } catch {
    /* best-effort */
  }
  return fallback;
}

async function refreshPlaylistAggregates(sb: SB, playlistId: string): Promise<void> {
  try {
    const { count } = await sb
      .from("managed_playlist_tracks")
      .select("*", { count: "exact", head: true })
      .eq("playlist_id", playlistId);
    await sb
      .from("managed_playlists")
      .update({
        tracks_count: count ?? 0,
        tracks_hash: null, // força próximo sync a reconciliar
        last_metrics_at: new Date().toISOString(),
      })
      .eq("id", playlistId);
  } catch {
    /* best-effort */
  }
}

/**
 * Espelha localmente um INSERT que já aconteceu no Spotify (HTTP 200/201).
 * Idempotente: ignora colisão na UNIQUE(playlist_id, spotify_track_id).
 */
export async function mptInsertFromCatalog(
  sb: SB,
  args: { playlist_id: string; spotify_track_id: string; added_at?: string },
): Promise<void> {
  const addedAt = args.added_at ?? new Date().toISOString();

  // Calcula próxima posição (append).
  let nextPos = 0;
  try {
    const { data: maxRow } = await sb
      .from("managed_playlist_tracks")
      .select("position")
      .eq("playlist_id", args.playlist_id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    nextPos = (maxRow?.position ?? -1) + 1;
  } catch {
    nextPos = 0;
  }

  const meta = await loadTrackMetadata(sb, args.spotify_track_id);

  const row = {
    playlist_id: args.playlist_id,
    spotify_track_id: args.spotify_track_id,
    track_name: meta.track_name,
    artist_name: meta.artist_name,
    album_cover: meta.album_cover,
    position: nextPos,
    added_at: addedAt,
    duration_ms: meta.duration_ms,
    isrc: meta.isrc,
  };

  try {
    const { error } = await sb
      .from("managed_playlist_tracks")
      .upsert(row, { onConflict: "playlist_id,spotify_track_id" });
    if (error) {
      // Se colidir em UNIQUE(playlist_id, position) por race com sync, recua e tenta de novo
      // sem position (atualiza metadado preservando posição existente).
      if (/duplicate key|unique/i.test(error.message)) {
        await sb
          .from("managed_playlist_tracks")
          .upsert(
            {
              ...row,
              position: nextPos + 1,
            },
            { onConflict: "playlist_id,spotify_track_id" },
          )
          .then(() => {}, () => {});
      }
    }
  } catch {
    /* best-effort */
  }

  await refreshPlaylistAggregates(sb, args.playlist_id);
}

/**
 * Espelha localmente um REMOVE que já aconteceu no Spotify (HTTP 200).
 */
export async function mptRemoveFromCatalog(
  sb: SB,
  args: { playlist_id: string; spotify_track_id: string },
): Promise<void> {
  try {
    await sb
      .from("managed_playlist_tracks")
      .delete()
      .eq("playlist_id", args.playlist_id)
      .eq("spotify_track_id", args.spotify_track_id);
  } catch {
    /* best-effort */
  }
  await refreshPlaylistAggregates(sb, args.playlist_id);
}
