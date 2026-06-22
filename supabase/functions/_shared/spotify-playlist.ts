// _shared/spotify-playlist.ts
// =====================================================================
// HELPERS CANÔNICOS para operações OAUTENTICADAS em playlists do Spotify.
//
// RESPONSABILIDADE ÚNICA (pós Onda 3 da Migração 17-C):
//   Única porta de entrada para chamadas que exigem OAuth de App (token de
//   dono) — escrita e leitura proprietária. Inclui:
//     - ADD / REMOVE / REORDER / REPLACE de tracks
//     - PUT detalhes da playlist (name/description/public/collaborative)
//     - PUT capa (image/jpeg)
//     - POST criar playlist
//     - GET metadata / GET items RICOS de playlists próprias ou geridas
//       (usados para validar ownership/snapshot antes de escrever, ou
//        para hidratar managed_playlists com o token do dono).
//
// PROIBIDO neste módulo:
//   - Leituras públicas anônimas (qualquer caller que não precise de token
//     de dono DEVE usar `_shared/observer-playlist.ts`).
//   - Caminhos legados via Client Credentials.
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

import { guardedSpotifyFetch, openSpotifyCircuitBreaker, SpotifyAuthInvalidError } from "./spotify.ts";

export type SpotifyFetch = (
  url: string,
  init: RequestInit,
  token: string,
) => Promise<any>;

/**
 * Erro lançado por defaultSpotifyFetch. Expõe `status` (HTTP) e `retryAfter`
 * (segundos parseados do header Retry-After) pra consumers que precisam decidir
 * retry/backoff (ex: enrich-playlists distingue 401/404/429).
 */
export class SpotifyApiError extends Error {
  status: number;
  retryAfter: number | null;
  body: string;
  constructor(status: number, body: string, retryAfter: number | null) {
    super(`Spotify ${status}: ${body.slice(0, 400)}`);
    this.name = "SpotifyApiError";
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

/** Fetch wrapper padrão — joga SpotifyApiError com status + body + retryAfter.
 *  Em 401 lança SpotifyAuthInvalidError (NÃO subclasse de SpotifyApiError pra
 *  callers críticos pegarem com catch específico e fazer failover de app sem
 *  ambiguidade com 404/429). Callers que só fazem catch genérico continuam OK. */
export const defaultSpotifyFetch: SpotifyFetch = async (url, init, token) => {
  const r = await guardedSpotifyFetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) {
    const t = await r.text();
    const ra = Number(r.headers.get("Retry-After") ?? "");
    const retryAfter = Number.isFinite(ra) && ra > 0 ? ra : null;
    if (r.status === 401) {
      // Fail-fast: caller pode trocar app e retentar. guardedSpotifyFetch já
      // chamou markAppAuthFailure(AUTH_INVALID) em fire-and-forget.
      throw new SpotifyAuthInvalidError(null, t);
    }
    throw new SpotifyApiError(r.status, t, retryAfter);
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

function toTrackId(uriOrId: string): string {
  return uriOrId.startsWith("spotify:track:") ? uriOrId.split(":").pop() ?? uriOrId : uriOrId;
}

export type PlaylistTrackRef = {
  uri: string;
  id: string | null;
  linked_from_uri?: string | null;
  linked_from_id?: string | null;
};

export function trackRefMatches(ref: PlaylistTrackRef, uriOrId: string): boolean {
  const uri = toUri(uriOrId);
  const id = toTrackId(uriOrId);
  return ref.uri === uri || ref.id === id || ref.linked_from_uri === uri || ref.linked_from_id === id;
}

export function findPlaylistTrackIndex(refs: PlaylistTrackRef[], uriOrId: string): number {
  return refs.findIndex((ref) => trackRefMatches(ref, uriOrId));
}

/** Lista TODAS as faixas com URI primária e linked_from para evitar relink por mercado/conta. */
export async function listPlaylistTrackRefs(
  playlistId: string,
  token: string,
  fetcher: SpotifyFetch = defaultSpotifyFetch,
): Promise<PlaylistTrackRef[]> {
  const refs: PlaylistTrackRef[] = [];
  // NOTE: Spotify v1 retorna o objeto da faixa em DOIS formatos:
  //   - legado: items[].track  (playlists antigas / certas contas)
  //   - novo:   items[].item   (rollout unificado tracks+episodes em 2026)
  // Pedimos os DOIS campos e aceitamos qualquer um na parsing pra não voltar vazio.
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/items?fields=items(track(id,uri,type,linked_from(id,uri)),item(id,uri,type,linked_from(id,uri))),next&limit=100`;
  while (url) {
    const j: any = await fetcher(url, { method: "GET" }, token);
    for (const it of j.items ?? []) {
      const tr = it?.track ?? it?.item;
      if (!tr?.uri) continue;
      // Filtra episódios (só queremos tracks)
      if (tr.type && tr.type !== "track") continue;
      refs.push({
        uri: tr.uri,
        id: tr.id ?? null,
        linked_from_uri: tr.linked_from?.uri ?? null,
        linked_from_id: tr.linked_from?.id ?? null,
      });
    }
    url = j.next ?? null;
  }
  return refs;
}

/** Lista TODAS as URIs de tracks da playlist (paginado, 100 por página). */
export async function listPlaylistTrackUris(
  playlistId: string,
  token: string,
  fetcher: SpotifyFetch = defaultSpotifyFetch,
): Promise<string[]> {
  return (await listPlaylistTrackRefs(playlistId, token, fetcher)).map((ref) => ref.uri);
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

// =====================================================================
// Metadata / identity / cover / creation / rich listing
// =====================================================================

export type SpotifyImage = { url: string; width: number | null; height: number | null };

export type PlaylistMeta = {
  id: string;
  name: string;
  description: string | null;
  followers: number;
  tracks_total: number;
  owner_id: string | null;
  owner_display_name: string | null;
  images: SpotifyImage[];
  cover_url: string | null;
};

/**
 * GET /v1/playlists/{id} — metadata canônica.
 * `fields` é opcional; default cobre tudo que PlaylistMeta expõe.
 * Quando você passa `fields` custom, ainda recebe o objeto bruto via segundo retorno.
 */
export async function getPlaylistMeta(
  playlistId: string,
  token: string,
  opts: { fields?: string; fetcher?: SpotifyFetch } = {},
): Promise<PlaylistMeta & { raw: any }> {
  const fetcher = opts.fetcher ?? defaultSpotifyFetch;
  const fields = opts.fields
    ?? "id,name,description,followers(total),tracks(total),owner(id,display_name),images";
  const url = `https://api.spotify.com/v1/playlists/${playlistId}?fields=${encodeURIComponent(fields)}`;
  const j: any = await fetcher(url, { method: "GET" }, token);
  const images: SpotifyImage[] = Array.isArray(j?.images)
    ? j.images.map((im: any) => ({
        url: im?.url ?? "",
        width: typeof im?.width === "number" ? im.width : null,
        height: typeof im?.height === "number" ? im.height : null,
      })).filter((im: SpotifyImage) => im.url)
    : [];
  return {
    id: j?.id ?? playlistId,
    name: j?.name ?? "",
    description: j?.description ?? null,
    followers: j?.followers?.total ?? 0,
    tracks_total: j?.tracks?.total ?? 0,
    owner_id: j?.owner?.id ?? null,
    owner_display_name: j?.owner?.display_name ?? null,
    images,
    cover_url: images[0]?.url ?? null,
    raw: j,
  };
}

/**
 * PUT /v1/playlists/{id} — altera name / description / public / collaborative.
 * Pelo menos um campo deve ser passado.
 */
export async function setPlaylistDetails(
  playlistId: string,
  details: {
    name?: string;
    description?: string;
    public?: boolean;
    collaborative?: boolean;
  },
  token: string,
  opts: { fetcher?: SpotifyFetch } = {},
): Promise<void> {
  const fetcher = opts.fetcher ?? defaultSpotifyFetch;
  const body: Record<string, unknown> = {};
  if (typeof details.name === "string") body.name = details.name;
  if (typeof details.description === "string") body.description = details.description;
  if (typeof details.public === "boolean") body.public = details.public;
  if (typeof details.collaborative === "boolean") body.collaborative = details.collaborative;
  if (Object.keys(body).length === 0) {
    throw new Error("setPlaylistDetails: pelo menos um campo (name/description/public/collaborative) é obrigatório");
  }
  await fetcher(
    `https://api.spotify.com/v1/playlists/${playlistId}`,
    { method: "PUT", body: JSON.stringify(body) },
    token,
  );
}

/**
 * PUT /v1/playlists/{id}/images — sobe capa JPEG.
 * Aceita base64 (sem prefixo data:) ou um Uint8Array — que vira base64 internamente.
 * Limite Spotify: 256 KB no JPEG já encodado.
 * NOTE: este endpoint usa Content-Type: image/jpeg e body cru base64, não JSON.
 */
export async function uploadPlaylistCover(
  playlistId: string,
  jpeg: string | Uint8Array,
  token: string,
): Promise<void> {
  let base64: string;
  if (typeof jpeg === "string") {
    base64 = jpeg.replace(/^data:image\/\w+;base64,/, "");
  } else {
    let bin = "";
    for (let i = 0; i < jpeg.length; i++) bin += String.fromCharCode(jpeg[i]);
    base64 = btoa(bin);
  }
  const r = await guardedSpotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/images`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "image/jpeg",
    },
    body: base64,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Spotify ${r.status} (upload cover): ${t.slice(0, 400)}`);
  }
}

/**
 * POST /v1/users/{userId}/playlists — cria playlist na conta do usuário.
 * Retorna o id da playlist criada (necessário pra próximos passos: add tracks, cover, etc).
 */
export async function createPlaylist(
  userId: string,
  details: {
    name: string;
    description?: string;
    public?: boolean;
    collaborative?: boolean;
  },
  token: string,
  opts: { fetcher?: SpotifyFetch } = {},
): Promise<{ id: string; raw: any }> {
  const fetcher = opts.fetcher ?? defaultSpotifyFetch;
  const body: Record<string, unknown> = { name: details.name };
  if (typeof details.description === "string") body.description = details.description;
  if (typeof details.public === "boolean") body.public = details.public;
  if (typeof details.collaborative === "boolean") body.collaborative = details.collaborative;
  const j: any = await fetcher(
    `https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists`,
    { method: "POST", body: JSON.stringify(body) },
    token,
  );
  if (!j?.id) throw new Error("createPlaylist: Spotify não retornou id");
  return { id: j.id, raw: j };
}

export type RichTrack = {
  spotify_track_id: string | null;
  uri: string | null;
  name: string;
  artists: string;
  artist_names: string[];
  album: string | null;
  album_cover: string | null;
  album_images: SpotifyImage[];
  release_date: string | null;
  duration_ms: number | null;
  popularity: number | null;
  isrc: string | null;
  added_at: string | null;
  position: number;
};

/**
 * GET /v1/playlists/{id}/items — listagem rica (name, artists, album, duration, popularity).
 * Use isto pra hidratação / snapshots de tracks. Paginado, 100 por página.
 *
 * `max`: corta a coleta (default 1000). `fields`: override completo se precisar.
 */
export async function listPlaylistTracksRich(
  playlistId: string,
  token: string,
  opts: { max?: number; fields?: string; fetcher?: SpotifyFetch } = {},
): Promise<RichTrack[]> {
  const fetcher = opts.fetcher ?? defaultSpotifyFetch;
  const max = Math.max(1, opts.max ?? 1000);
  // Spotify mudou o shape do payload em 2026: cada entry pode vir como `.track`
  // (legado) OU `.item` (novo). Pedimos ambos no fields mask e o parser aceita
  // qualquer um — sem isso, o mask filtra só `track(...)` e 100% das tracks
  // são descartadas em playlists no formato novo.
  const fields = opts.fields ?? "items(added_at,track(id,uri,name,duration_ms,popularity,external_ids,artists(name),album(name,release_date,images)),item(id,uri,name,duration_ms,popularity,external_ids,artists(name),album(name,release_date,images))),next";
  const out: RichTrack[] = [];
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/items?fields=${encodeURIComponent(fields)}&limit=100`;
  let pos = 0;
  while (url && out.length < max) {
    const j: any = await fetcher(url, { method: "GET" }, token);
    for (const it of j.items ?? []) {
      const tr = it?.track ?? it?.item;
      pos++;
      if (!tr || !tr.id) continue;
      const artistNames: string[] = Array.isArray(tr.artists)
        ? tr.artists.map((a: any) => a?.name).filter((n: any) => typeof n === "string" && n.length)
        : [];
      const images: SpotifyImage[] = Array.isArray(tr.album?.images)
        ? tr.album.images.map((im: any) => ({
            url: im?.url ?? "",
            width: typeof im?.width === "number" ? im.width : null,
            height: typeof im?.height === "number" ? im.height : null,
          })).filter((im: SpotifyImage) => im.url)
        : [];
      const rawIsrc = tr.external_ids?.isrc;
      out.push({
        spotify_track_id: tr.id ?? null,
        uri: tr.uri ?? null,
        name: tr.name ?? "Unknown",
        artists: artistNames.join(", ") || "Unknown",
        artist_names: artistNames,
        album: tr.album?.name ?? null,
        album_cover: images[images.length - 1]?.url ?? images[0]?.url ?? null,
        album_images: images,
        release_date: typeof tr.album?.release_date === "string" ? tr.album.release_date : null,
        duration_ms: typeof tr.duration_ms === "number" ? tr.duration_ms : null,
        popularity: typeof tr.popularity === "number" ? tr.popularity : null,
        isrc: typeof rawIsrc === "string" && rawIsrc.length > 0 ? rawIsrc.toUpperCase() : null,
        added_at: typeof it?.added_at === "string" ? it.added_at : null,
        position: pos,
      });
      if (out.length >= max) break;
    }
    url = j.next ?? null;
  }
  return out;
}

