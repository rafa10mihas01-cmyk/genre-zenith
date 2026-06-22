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

/** Busca metadados públicos de uma playlist via Spotify Web API (client credentials). */
export async function fetchPlaylistMeta(playlistId: string): Promise<SpotifyPlaylistMeta | null> {
  const token = await getSpotifyToken();
  const fields =
    "id,name,owner(id,display_name),followers(total),images(url),tracks(total)";
  const res = await fetchWithRetry(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Spotify playlist ${playlistId} HTTP ${res.status}`);
  }
  const j = await res.json();
  return {
    id: j.id,
    name: j.name ?? "Playlist",
    owner_id: j.owner?.id ?? "",
    owner_name: j.owner?.display_name ?? j.owner?.id ?? "",
    followers: j.followers?.total ?? 0,
    image_url: Array.isArray(j.images) && j.images.length > 0 ? j.images[0].url : null,
    total_tracks: j.tracks?.total ?? 0,
  };
}

export type PlaylistTrackPresence = {
  found: boolean;
  position: number | null;
  track_name: string | null;
  artist_name: string | null;
};

/** Confere se uma faixa já existe na playlist pública do Spotify. */
export async function checkTrackInPlaylist(
  playlistId: string,
  trackId: string | null,
): Promise<PlaylistTrackPresence> {
  if (!playlistId || !trackId) {
    return { found: false, position: null, track_name: null, artist_name: null };
  }

  const token = await getSpotifyToken();
  // Inclui linked_from pra cobrir track relinking (regional/remaster). O Spotify
  // pode retornar um id diferente do "original" quando a faixa foi relincada.
  const fields = "items(track(id,name,artists(name),linked_from(id),external_ids(isrc))),next";
  let offset = 0;
  let position = 0;

  // Busca o ISRC da faixa "original" pra fallback de match (cobre casos onde o
  // mesmo lançamento existe em álbuns/regiões diferentes com ids distintos).
  let originalIsrc: string | null = null;
  try {
    const trRes = await fetchWithRetry(
      `https://api.spotify.com/v1/tracks/${trackId}?market=from_token`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (trRes.ok) {
      const tj = await trRes.json();
      originalIsrc = tj?.external_ids?.isrc ?? null;
    } else {
      await trRes.text().catch(() => {});
    }
  } catch (_) { /* ignore */ }

  while (offset < 10000) {
    const url = new URL(`https://api.spotify.com/v1/playlists/${playlistId}/items`);
    url.searchParams.set("fields", fields);
    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", String(offset));
    const res = await fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return { found: false, position: null, track_name: null, artist_name: null };
    if (!res.ok) throw new Error(`Spotify playlist tracks ${playlistId} HTTP ${res.status}`);

    const j = await res.json();
    const items = Array.isArray(j.items) ? j.items : [];
    for (const item of items) {
      position += 1;
      const track = item?.track;
      if (!track) continue;
      const linkedId = track?.linked_from?.id ?? null;
      const isrc = track?.external_ids?.isrc ?? null;
      const idMatch = track.id === trackId || linkedId === trackId;
      const isrcMatch = !!originalIsrc && !!isrc && originalIsrc === isrc;
      if (idMatch || isrcMatch) {
        const artists = Array.isArray(track.artists) ? track.artists : [];
        return {
          found: true,
          position,
          track_name: track.name ?? null,
          artist_name: artists.map((a: any) => a?.name).filter(Boolean).join(", ") || null,
        };
      }
    }

    if (!j.next || items.length === 0) break;
    offset += items.length;
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
