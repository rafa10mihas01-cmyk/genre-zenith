// _shared/curator-playlist.ts
// =====================================================================
// Helpers de classificação e parsing pra fluxos do CRM de curadores.
//
// RESPONSABILIDADE (pós Onda 3 da Migração 17-C):
//   - regex/extractors de URL Spotify;
//   - leitura de metadados PÚBLICOS de playlist via Observer (apenas);
//   - check de presença de track numa playlist pública via Observer + cache;
//   - regras de classificação (curator/baseline/editorial/suspicious/organic).
//
// PROIBIDO neste módulo:
//   - chamadas diretas a api.spotify.com (público ou OAuth);
//   - leitura de items via Client Credentials.
// Toda leitura pública passa pelo Observer. Track ISRC vem do cache local.
// =====================================================================

import {
  observerGetPlaylist,
  observerListAllPlaylistItems,
} from "./observer-playlist.ts";
import { getTrackCacheBatch } from "./spotify-cache.ts";


export const SPOTIFY_PLAYLIST_RE =
  /spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([A-Za-z0-9]+)/i;

export function extractPlaylistId(url: string): string | null {
  const m = url.match(SPOTIFY_PLAYLIST_RE);
  return m ? m[1] : null;
}

export const SPOTIFY_TRACK_RE =
  /spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]+)|spotify:track:([A-Za-z0-9]+)/i;

export function extractTrackId(url: string): string | null {
  const m = url.match(SPOTIFY_TRACK_RE);
  return m ? (m[1] || m[2] || null) : null;
}

export type SpotifyPlaylistMeta = {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string;
  followers: number;
  image_url: string | null;
  total_tracks: number;
};

/** Busca metadados públicos de uma playlist via Observer (Fase 17-C). */
export async function fetchPlaylistMeta(playlistId: string): Promise<SpotifyPlaylistMeta | null> {
  try {
    const p = await observerGetPlaylist(playlistId);
    return {
      id: p.id,
      name: p.name ?? "Playlist",
      owner_id: p.owner?.id ?? "",
      owner_name: p.owner?.display_name ?? p.owner?.id ?? "",
      followers: p.followers?.total ?? 0,
      image_url: Array.isArray(p.images) && p.images.length > 0 ? p.images[0].url : null,
      total_tracks: p.tracks?.total ?? 0,
    };
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 404) return null;
    throw e;
  }
}

export type PlaylistTrackPresence = {
  found: boolean;
  position: number | null;
  track_name: string | null;
  artist_name: string | null;
};

/**
 * Confere se uma faixa existe numa playlist pública.
 *
 * Fase 17-C / Onda 3: lê items via Observer (VPS) e resolve ISRC pelo cache
 * local (`spotify_track_cache`). NÃO chama mais api.spotify.com.
 *
 * Limitação aceita: Observer não expõe `linked_from`. O match acontece por
 *   (a) id direto, ou
 *   (b) ISRC original × ISRC do item — usando spotify_track_cache pra ambos.
 * Tracks ainda não presentes no cache não participam do fallback ISRC; o
 * worker de enriquecimento popula o cache assincronamente.
 */
export async function checkTrackInPlaylist(
  playlistId: string,
  trackId: string | null,
): Promise<PlaylistTrackPresence> {
  if (!playlistId || !trackId) {
    return { found: false, position: null, track_name: null, artist_name: null };
  }

  let items;
  try {
    items = await observerListAllPlaylistItems(playlistId);
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 404) return { found: false, position: null, track_name: null, artist_name: null };
    throw e;
  }

  // Coleta ids pra resolver ISRCs via cache num único batch
  const itemIds: string[] = [];
  for (const it of items) {
    const id = it?.track?.id;
    if (id) itemIds.push(id);
  }
  const idsForCache = Array.from(new Set([trackId, ...itemIds]));
  let isrcByTrackId = new Map<string, string | null>();
  try {
    const cacheRows = await getTrackCacheBatch(idsForCache);
    isrcByTrackId = new Map(cacheRows.map((r) => [r.spotify_track_id, r.isrc ?? null]));
  } catch (_) { /* cache opcional pra ISRC fallback */ }

  const originalIsrc = isrcByTrackId.get(trackId) ?? null;

  let position = 0;
  for (const item of items) {
    position += 1;
    const track = item?.track;
    if (!track) continue;
    const idMatch = track.id === trackId;
    const itemIsrc = isrcByTrackId.get(track.id) ?? null;
    const isrcMatch = !!originalIsrc && !!itemIsrc && originalIsrc === itemIsrc;
    if (idMatch || isrcMatch) {
      const artists = Array.isArray(track.artists) ? track.artists : [];
      return {
        found: true,
        position,
        track_name: track.name ?? null,
        artist_name: artists.map((a: { name?: string }) => a?.name).filter(Boolean).join(", ") || null,
      };
    }
  }

  return { found: false, position: null, track_name: null, artist_name: null };
}


export type MatchStatus = "curator" | "baseline" | "editorial" | "suspicious" | "organic";

export type ClassifyInput = {
  playlist: SpotifyPlaylistMeta;
  dealOwnerId: string | null;
  dealStartedAt: string; // ISO timestamp
  addedAtSpotify?: string | null; // YYYY-MM-DD
  /** Lista de owner_ids já vistos como curador deste deal (pra detectar sósia). */
  knownCuratorOwnerIds?: string[];
  /** Lista de nomes de playlists já cadastradas pelo curador (pra detectar sósia). */
  curatorPlaylistNames?: string[];
};

export type ClassifyResult = {
  match_status: MatchStatus;
  match_reason: string;
};

const EDITORIAL_OWNER_IDS = new Set(["spotify"]);

/** Classifica uma playlist com base em regras de owner + janela temporal. */
export function classifyPlaylist(input: ClassifyInput): ClassifyResult {
  const { playlist, dealOwnerId, dealStartedAt, addedAtSpotify } = input;
  const ownerId = (playlist.owner_id || "").toLowerCase();
  const dealOwner = (dealOwnerId || "").toLowerCase();

  // 1) Editorial Spotify
  if (EDITORIAL_OWNER_IDS.has(ownerId)) {
    return {
      match_status: "editorial",
      match_reason: "playlist editorial do Spotify (owner=spotify)",
    };
  }

  // 2) Owner do curador conhecido
  if (dealOwner && ownerId === dealOwner) {
    if (!addedAtSpotify) {
      return {
        match_status: "curator",
        match_reason: "owner bate com curador (sem data de adição informada)",
      };
    }
    const addedDate = new Date(`${addedAtSpotify}T23:59:59Z`).getTime();
    const startDate = new Date(dealStartedAt).getTime();
    // Comparação por dia: se foi adicionada no mesmo dia ou depois, conta no ciclo.
    const startDay = new Date(dealStartedAt);
    startDay.setUTCHours(0, 0, 0, 0);
    if (addedDate >= startDay.getTime()) {
      return {
        match_status: "curator",
        match_reason: `owner bate + adicionada em ${addedAtSpotify} (dentro do ciclo)`,
      };
    }
    return {
      match_status: "baseline",
      match_reason: `owner bate mas adicionada antes do início do ciclo (${addedAtSpotify})`,
    };
  }

  // 3) Sósia: nome igual a uma do curador, owner diferente
  const nameLc = (playlist.name || "").trim().toLowerCase();
  const knownNames = (input.curatorPlaylistNames || []).map((n) =>
    (n || "").trim().toLowerCase()
  );
  if (nameLc && knownNames.includes(nameLc)) {
    return {
      match_status: "suspicious",
      match_reason: `nome idêntico a playlist do curador, owner diferente (${playlist.owner_name})`,
    };
  }

  // 4) Default: orgânica
  return {
    match_status: "organic",
    match_reason: `dono: ${playlist.owner_name || "desconhecido"}`,
  };
}
