// _shared/spotify-playlist-id.ts
// Extrator canônico de Playlist ID do Spotify.
//
// A URL é apenas entrada/exibição. A identidade do sistema é o Playlist ID
// (base62, 22 chars na prática, aceitamos 16-32 por segurança).
//
// Aceita:
//   - https://open.spotify.com/playlist/<id>
//   - https://open.spotify.com/playlist/<id>?si=...
//   - http://open.spotify.com/playlist/<id>
//   - open.spotify.com/playlist/<id>
//   - spotify:playlist:<id>
//   - <id> puro (22 chars base62)
//
// Retorna null se não conseguir extrair um ID válido.

const ID_REGEX = /^[a-zA-Z0-9]{16,32}$/;

export function extractPlaylistId(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // ID puro
  if (ID_REGEX.test(raw)) return raw;

  // spotify:playlist:<id>
  const uri = raw.match(/spotify:playlist:([a-zA-Z0-9]{16,32})/i);
  if (uri) return uri[1];

  // URL (com ou sem protocolo / com ou sem query)
  const url = raw.match(/playlist\/([a-zA-Z0-9]{16,32})/i);
  if (url) return url[1];

  return null;
}

/** Normaliza pra forma canônica https://open.spotify.com/playlist/<id>. */
export function canonicalPlaylistUrl(input: string | null | undefined): string | null {
  const id = extractPlaylistId(input);
  return id ? `https://open.spotify.com/playlist/${id}` : null;
}
