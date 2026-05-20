// _shared/spotify-playlist.ts
// =====================================================================
// HELPERS CANÔNICOS para mutações de tracks em playlists do Spotify.
//
// REGRA DE OURO — qualquer edge function que mexer em faixas de playlist
// DEVE usar estes helpers ao invés de chamar `fetch` direto. Isso evita
// repetir bugs já caçados (endpoint deprecado, body errado, chunk >100, etc).
//
// Endpoints corretos (validados em produção em 2026-05):
//   - LIST     → GET    /v1/playlists/{id}/items?fields=...&limit=100
//   - ADD      → POST   /v1/playlists/{id}/items   body: { uris: string[], position?: number }
//   - REMOVE   → DELETE /v1/playlists/{id}/items   body: { items: [{ uri }] }   ← NÃO usar /tracks, NÃO usar { tracks: [...] }
//   - REORDER  → PUT    /v1/playlists/{id}/items   body: { range_start, insert_before, range_length }
//   - REPLACE  → PUT    /v1/playlists/{id}/items   body: { uris: string[] }      (até 100; pra mais, use REMOVE+ADD)
//
// Todos respeitam o limite de 100 URIs por chamada do Spotify.
// =====================================================================

export type SpotifyFetch = (
  url: string,
  init: RequestInit,
  token: string,
) => Promise<any>;

/** Fetch wrapper padrão — joga erro com status + body do Spotify. */
export const defaultSpotifyFetch: SpotifyFetch = async (url, init, token) => {
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Spotify ${r.status}: ${t.slice(0, 400)}`);
  }
  // DELETE/PUT podem voltar 200 sem body útil
  const txt = await r.text();
  if (!txt) return {};
  try { return JSON.parse(txt); } catch { return {}; }
};

function chunk<T>(arr: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toUri(uriOrId: string): string {
  return uriOrId.startsWith("spotify:track:") ? uriOrId : `spotify:track:${uriOrId}`;
}

/** Lista TODAS as URIs de tracks da playlist (paginado, 100 por página). */
export async function listPlaylistTrackUris(
  playlistId: string,
  token: string,
  fetcher: SpotifyFetch = defaultSpotifyFetch,
): Promise<string[]> {
  const uris: string[] = [];
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/items?fields=items(track(uri)),next&limit=100`;
  while (url) {
    const j: any = await fetcher(url, { method: "GET" }, token);
    for (const it of j.items ?? []) {
      const u = it?.track?.uri;
      if (u) uris.push(u);
    }
    url = j.next ?? null;
  }
  return uris;
}

/** Adiciona faixas (POST /items, até 100 por chunk). */
export async function addPlaylistTracks(
  playlistId: string,
  uris: string[],
  token: string,
  opts: { position?: number; fetcher?: SpotifyFetch } = {},
): Promise<{ snapshot_id?: string; added: number }> {
  const fetcher = opts.fetcher ?? defaultSpotifyFetch;
  const norm = uris.map(toUri);
  let snapshot_id: string | undefined;
  for (const ch of chunk(norm)) {
    const body: Record<string, unknown> = { uris: ch };
    if (typeof opts.position === "number") body.position = opts.position;
    const r = await fetcher(
      `https://api.spotify.com/v1/playlists/${playlistId}/items`,
      { method: "POST", body: JSON.stringify(body) },
      token,
    );
    snapshot_id = r?.snapshot_id ?? snapshot_id;
  }
  return { snapshot_id, added: norm.length };
}

/** Remove faixas (DELETE /items com { items: [{uri}] }, até 100 por chunk). */
export async function removePlaylistTracks(
  playlistId: string,
  uris: string[],
  token: string,
  opts: { fetcher?: SpotifyFetch } = {},
): Promise<{ snapshot_id?: string; removed: number }> {
  const fetcher = opts.fetcher ?? defaultSpotifyFetch;
  const norm = uris.map(toUri);
  let snapshot_id: string | undefined;
  for (const ch of chunk(norm)) {
    const r = await fetcher(
      `https://api.spotify.com/v1/playlists/${playlistId}/items`,
      { method: "DELETE", body: JSON.stringify({ items: ch.map((uri) => ({ uri })) }) },
      token,
    );
    snapshot_id = r?.snapshot_id ?? snapshot_id;
  }
  return { snapshot_id, removed: norm.length };
}

/** Reordena uma faixa (PUT /items com range_start/insert_before/range_length). */
export async function reorderPlaylistTracks(
  playlistId: string,
  args: { range_start: number; insert_before: number; range_length?: number },
  token: string,
  opts: { fetcher?: SpotifyFetch } = {},
): Promise<{ snapshot_id?: string }> {
  const fetcher = opts.fetcher ?? defaultSpotifyFetch;
  const body = {
    range_start: args.range_start,
    insert_before: args.insert_before,
    range_length: args.range_length ?? 1,
  };
  const r = await fetcher(
    `https://api.spotify.com/v1/playlists/${playlistId}/items`,
    { method: "PUT", body: JSON.stringify(body) },
    token,
  );
  return { snapshot_id: r?.snapshot_id };
}

/** Substitui completamente as faixas da playlist (até 100). Acima disso, use remove+add. */
export async function replacePlaylistTracks(
  playlistId: string,
  uris: string[],
  token: string,
  opts: { fetcher?: SpotifyFetch } = {},
): Promise<{ snapshot_id?: string }> {
  const fetcher = opts.fetcher ?? defaultSpotifyFetch;
  const norm = uris.map(toUri).slice(0, 100);
  const r = await fetcher(
    `https://api.spotify.com/v1/playlists/${playlistId}/items`,
    { method: "PUT", body: JSON.stringify({ uris: norm }) },
    token,
  );
  return { snapshot_id: r?.snapshot_id };
}
