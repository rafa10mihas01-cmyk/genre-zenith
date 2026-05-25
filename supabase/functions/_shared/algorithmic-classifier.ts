// Classificador de playlists do Spotify — fonte ÚNICA de "isto é
// playlist algorítmica/superfície interna" entre todas as edge functions.
//
// Extraído de extract-snapshot-from-print/index.ts (mantém a mesma
// regra exata) pra poder ser reutilizado por ingest-dom e
// bot-ingest-snapshot, que precisam decidir se uma playlist NÃO
// cadastrada no deal é descarte real ou tração algorítmica.

const ALGO_NAMES = new Set([
  "radio", "mixes", "daylist", "smart shuffle", "on repeat", "blend",
  "your dj", "discover weekly", "release radar", "made for you",
  "repeat rewind", "your top songs", "niche mixes", "uniquely yours",
]);

/**
 * Verdadeiro quando a playlist é uma superfície ALGORÍTMICA do Spotify
 * (Rádio, Mixes, Daily Mix N, Discover Weekly, Release Radar, Smart Shuffle...).
 * - Casa por nome canônico.
 * - Casa variações tipo "Daily Mix 1", "Mix 3", "Your X Mix".
 * - Casa qualquer linha made_by=Spotify SEM playlist_id real (superfície interna).
 *
 * NÃO marca como algorítmica playlists editoriais oficiais do Spotify
 * (ex: "This Is X", "Hot Hits Brasil") que têm playlist_id real começando
 * com 37i9dQZF — pra isso use isSpotifyEditorial.
 */
export function isAlgorithmic(
  name: string | null | undefined,
  madeBy: string | null | undefined,
  spotifyId?: string | null,
): boolean {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return false;
  if (ALGO_NAMES.has(n)) return true;
  if (/\b(daily mix|mix \d+|on repeat|smart shuffle)\b/.test(n)) return true;
  if ((madeBy ?? "").trim().toLowerCase() === "spotify" && !(spotifyId ?? "").trim()) return true;
  return false;
}

/**
 * Playlist editorial oficial do Spotify (made_by Spotify + id real, não algorítmica).
 */
export function isSpotifyEditorial(
  name: string | null | undefined,
  madeBy: string | null | undefined,
  spotifyId?: string | null,
): boolean {
  const hasRealPlaylistId = !!spotifyId && !String(spotifyId).startsWith("algo:");
  if (!hasRealPlaylistId) return false;
  if (isAlgorithmic(name, madeBy, spotifyId)) return false;
  return (madeBy ?? "").trim().toLowerCase() === "spotify" || String(spotifyId).startsWith("37i9dQZF");
}

export type OrganicKind = "algorithmic" | "editorial" | "organic";

/**
 * Classifica em uma das 3 categorias do enum organic_play_kind.
 * "organic" é o catch-all pra playlists de terceiros não cadastradas no deal
 * (curadores fora do ecossistema, listas pessoais de usuários, etc.).
 */
export function classifyPlaylistKind(
  name: string | null | undefined,
  madeBy: string | null | undefined,
  spotifyId?: string | null,
): OrganicKind {
  if (isAlgorithmic(name, madeBy, spotifyId)) return "algorithmic";
  if (isSpotifyEditorial(name, madeBy, spotifyId)) return "editorial";
  return "organic";
}
