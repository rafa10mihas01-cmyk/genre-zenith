// _shared/curator-playlist.ts
// Helpers compartilhados para enriquecer e classificar playlists do curador.
import { getSpotifyToken } from "./spotify.ts";

export const SPOTIFY_PLAYLIST_RE =
  /spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([A-Za-z0-9]+)/i;

export function extractPlaylistId(url: string): string | null {
  const m = url.match(SPOTIFY_PLAYLIST_RE);
  return m ? m[1] : null;
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
  const res = await fetch(
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
