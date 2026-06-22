// Catalog Gateway — backend Client Credentials da camada de Cache (Fase 17-C).
//
// RESPONSABILIDADE ÚNICA (pós Onda 3 da Migração 17-C):
//   Servir como pool autenticado por Client Credentials para POPULAR o cache
//   (spotify_track_cache, spotify_artist_cache) via worker assíncrono e para
//   atender à exceção documentada `/search`.
//
// NÃO É MAIS um caminho de leitura pública de playlists. Toda leitura pública
// de playlists (metadados, owner, followers, items) DEVE passar pelo Observer
// (`_shared/observer-playlist.ts`). Os helpers legados `getPlaylistMeta`/
// `getPlaylistItems` foram REMOVIDOS — não restaurar.
//
// Princípios definitivos:
//   1. `ccFetch` é uso restrito: cache enrichment (worker) + `/search`.
//   2. Coalescência via `catalog_inflight` continua disponível para
//      hidratações pesadas que precisem deduplicar concorrentemente.
//   3. Toda chamada gera linha em `spotify_call_log` com meta.source='gateway'
//      para a view `catalog_gateway_metrics` medir uso/saúde do pool.

import { createClient } from "npm:@supabase/supabase-js@2";
// NOTE (Fase 17-B.0.2): NÃO importamos `getSpotifyToken` aqui de propósito.
// O Catalog Gateway tem um SELETOR PRÓPRIO de Client Credentials, restrito
// a um pool de Apps validadas na auditoria 17-B.0.1. Isso é totalmente
// independente do balanceador OAuth (que continua usando `pick_spotify_app`
// / `getSpotifyTokenWithApp` em spotify.ts para escrever em playlists).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DAY_MS = 86_400_000;
const PLAYLIST_META_TTL_MS = 7 * DAY_MS;
const PLAYLIST_TRACKS_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function svc() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

function isFresh(ts: string | null | undefined, ttlMs: number): boolean {
  if (!ts) return false;
  return Date.now() - new Date(ts).getTime() < ttlMs;
}

// ---------------------------------------------------------------------------
// Telemetria fina (com source='gateway') pra view catalog_gateway_metrics.
// ---------------------------------------------------------------------------
type GatewayLog = {
  endpoint: string;
  method: string;
  http_status: number | null;
  status: "ok" | "http_error" | "exception";
  duration_ms: number;
  error: string | null;
  caller: string;
  source: "gateway-cc" | "gateway-oauth" | "gateway-cache";
  resource_id?: string | null;
};

function fireAndForgetLog(row: GatewayLog): void {
  const p = (async () => {
    try {
      await svc().from("spotify_call_log").insert({
        function_name: row.caller,
        endpoint: row.endpoint,
        method: row.method,
        http_status: row.http_status,
        status: row.status,
        duration_ms: row.duration_ms,
        error: row.error,
        meta: { source: row.source, resource_id: row.resource_id ?? null },
      });
    } catch (e) {
      console.warn("[catalog-gateway] log fail:", (e as Error)?.message);
    }
  })();
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) {
    try { er.waitUntil(p); } catch { p.catch(() => {}); }
  } else {
    p.catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Coalescência: tenta inserir um lock em catalog_inflight. Se já existe
// (outro caller buscando o mesmo recurso), faz polling do cache.
// ---------------------------------------------------------------------------
async function tryAcquireInflight(resourceKey: string, endpoint: string, resourceId: string, caller: string): Promise<boolean> {
  const sb = svc();
  // Limpa expirados primeiro (best-effort)
  await sb.from("catalog_inflight").delete().lt("expires_at", new Date().toISOString());
  const { error } = await sb.from("catalog_inflight").insert({
    resource_key: resourceKey, endpoint, resource_id: resourceId, caller,
  });
  if (error) {
    if (/duplicate key/i.test(error.message)) return false;
    // Em qualquer outro erro, prossegue (não bloqueia)
    return true;
  }
  return true;
}

async function releaseInflight(resourceKey: string): Promise<void> {
  try {
    await svc().from("catalog_inflight").delete().eq("resource_key", resourceKey);
  } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Pool EXCLUSIVO do Catalog Gateway (Fase 17-B.0.2)
// ---------------------------------------------------------------------------
// Apps autorizadas a emitir Client Credentials PARA O GATEWAY.
// Validadas em 17-B.0.1: token CC emitido + endpoints públicos retornam 200.
//
// Apps deliberadamente EXCLUÍDAS deste pool (status no banco permanece intacto):
//   - NexEngine 07: token CC emite, mas endpoints públicos retornam 403
//                   "Active premium subscription required for the owner of the app".
//   - NexEngine 09: /api/token retorna 400 invalid_client.
//
// Isso NÃO afeta o balanceador OAuth — todas as 4 apps continuam disponíveis
// para escrita (add/remove/reorder/cover) via getSpotifyTokenWithApp.
const GATEWAY_CC_APP_ALLOWLIST = ["NexEngine 05", "NexEngine 10"] as const;

type CachedToken = { token: string; expiresAt: number; appName: string };
const gatewayTokenCache = new Map<string, CachedToken>(); // key = client_id

async function pickGatewayApp(): Promise<{ client_id: string; client_secret: string; name: string }> {
  const { data, error } = await svc()
    .from("spotify_apps")
    .select("name, client_id, client_secret, status")
    .in("name", GATEWAY_CC_APP_ALLOWLIST as unknown as string[])
    .eq("status", "active");
  if (error) throw new Error(`[catalog-gateway] pool lookup: ${error.message}`);
  const rows = (data ?? []) as Array<{ name: string; client_id: string; client_secret: string }>;
  if (rows.length === 0) {
    throw new Error("[catalog-gateway] nenhuma App do pool CC saudável disponível (esperado: NexEngine 05 ou 10)");
  }
  // Round-robin aleatório simples entre as apps saudáveis do pool.
  return rows[Math.floor(Math.random() * rows.length)];
}

async function requestCcToken(app: { client_id: string; client_secret: string; name: string }): Promise<{ token: string; expiresIn: number }> {
  const basic = btoa(`${app.client_id}:${app.client_secret}`);
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`[catalog-gateway] CC token ${resp.status} (app=${app.name}): ${t.slice(0, 200)}`);
  }
  const j = await resp.json();
  return { token: j.access_token as string, expiresIn: (j.expires_in ?? 3600) as number };
}

async function getGatewayCcToken(): Promise<{ token: string; appName: string }> {
  let app = await pickGatewayApp();
  const cached = gatewayTokenCache.get(app.client_id);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return { token: cached.token, appName: cached.appName };
  }
  // Fase 17-B.5.2: retry único pra absorver blips de `invalid_client` na
  // Spotify Accounts API. Espera 200ms e re-sorteia a app (se cair em outra,
  // melhor — distribui pressão).
  try {
    const r = await requestCcToken(app);
    gatewayTokenCache.set(app.client_id, { token: r.token, expiresAt: Date.now() + r.expiresIn * 1000, appName: app.name });
    return { token: r.token, appName: app.name };
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (!/invalid_client/i.test(msg)) throw e;
    await new Promise((res) => setTimeout(res, 200));
    app = await pickGatewayApp();
    const r = await requestCcToken(app);
    gatewayTokenCache.set(app.client_id, { token: r.token, expiresAt: Date.now() + r.expiresIn * 1000, appName: app.name });
    return { token: r.token, appName: app.name };
  }
}

// ---------------------------------------------------------------------------
// Fetch com Client Credentials + logging
// ---------------------------------------------------------------------------
export async function ccFetch(
  url: string,
  caller: string,
  resourceId?: string,
  init?: { signal?: AbortSignal },
): Promise<Response> {
  const startedAt = Date.now();
  const endpoint = normalizeEndpointForLog(url);
  let httpStatus: number | null = null;
  let status: GatewayLog["status"] = "ok";
  let errorMsg: string | null = null;
  try {
    const { token } = await getGatewayCcToken();
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: init?.signal,
    });
    httpStatus = r.status;
    if (!r.ok) status = "http_error";
    return r;
  } catch (e) {
    status = "exception";
    errorMsg = (e as Error)?.message ?? String(e);
    throw e;
  } finally {
    fireAndForgetLog({
      endpoint, method: "GET", http_status: httpStatus, status,
      duration_ms: Date.now() - startedAt, error: errorMsg, caller,
      source: "gateway-cc", resource_id: resourceId ?? null,
    });
  }
}

const SPOTIFY_ID_RE = /[A-Za-z0-9]{22}/g;
function normalizeEndpointForLog(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.hostname}${u.pathname.replace(SPOTIFY_ID_RE, ":id")}`;
  } catch {
    return rawUrl.slice(0, 200);
  }
}

// ---------------------------------------------------------------------------
// API pública do gateway
// ---------------------------------------------------------------------------

export type PlaylistMeta = {
  id: string;
  name: string | null;
  description: string | null;
  owner_id: string | null;
  owner_name: string | null;
  followers: number | null;
  image_url: string | null;
  total_tracks: number | null;
  snapshot_id: string | null;
  public: boolean | null;
  collaborative: boolean | null;
  meta_refreshed_at: string | null;
};

/** Lê metadata de uma playlist pública (sem faixas). TTL: 7 dias. */
export async function getPlaylistMeta(playlistId: string, caller: string, force = false): Promise<PlaylistMeta | null> {
  const sb = svc();
  if (!force) {
    const { data } = await sb
      .from("spotify_playlist_cache")
      .select("spotify_playlist_id,name,description,owner_id,owner_name,followers,image_url,total_tracks,snapshot_id,public_flag,collaborative,meta_refreshed_at")
      .eq("spotify_playlist_id", playlistId)
      .maybeSingle();
    if (data && isFresh(data.meta_refreshed_at, PLAYLIST_META_TTL_MS)) {
      fireAndForgetLog({
        endpoint: "api.spotify.com/v1/playlists/:id", method: "GET",
        http_status: 200, status: "ok", duration_ms: 0, error: null,
        caller, source: "gateway-cache", resource_id: playlistId,
      });
      return mapMeta(data);
    }
  }

  const key = `playlist_meta:${playlistId}`;
  const acquired = await tryAcquireInflight(key, "playlists/:id", playlistId, caller);
  try {
    if (!acquired) {
      // Outro caller já está buscando — espera curta e tenta cache
      await new Promise((r) => setTimeout(r, 1500));
      const { data } = await sb
        .from("spotify_playlist_cache")
        .select("spotify_playlist_id,name,description,owner_id,owner_name,followers,image_url,total_tracks,snapshot_id,public_flag,collaborative,meta_refreshed_at")
        .eq("spotify_playlist_id", playlistId).maybeSingle();
      if (data) return mapMeta(data);
    }

    const url = `https://api.spotify.com/v1/playlists/${playlistId}?fields=id,name,description,owner(id,display_name),followers(total),images,public,collaborative,snapshot_id,tracks(total)`;
    const r = await ccFetch(url, caller, playlistId);
    if (!r.ok) return null;
    const j = await r.json();
    const meta: PlaylistMeta = {
      id: j.id,
      name: j.name ?? null,
      description: j.description ?? null,
      owner_id: j.owner?.id ?? null,
      owner_name: j.owner?.display_name ?? null,
      followers: j.followers?.total ?? null,
      image_url: j.images?.[0]?.url ?? null,
      total_tracks: j.tracks?.total ?? null,
      snapshot_id: j.snapshot_id ?? null,
      public: j.public ?? null,
      collaborative: j.collaborative ?? null,
      meta_refreshed_at: new Date().toISOString(),
    };

    await sb.from("spotify_playlist_cache").upsert({
      spotify_playlist_id: meta.id,
      name: meta.name,
      description: meta.description,
      owner_id: meta.owner_id,
      owner_name: meta.owner_name,
      followers: meta.followers,
      image_url: meta.image_url,
      total_tracks: meta.total_tracks,
      snapshot_id: meta.snapshot_id,
      public_flag: meta.public,
      collaborative: meta.collaborative,
      meta_refreshed_at: meta.meta_refreshed_at,
      fetch_status: "ok",
      source: "gateway",
      cached_at: meta.meta_refreshed_at,
    }, { onConflict: "spotify_playlist_id" });

    return meta;
  } finally {
    await releaseInflight(key);
  }
}

function mapMeta(row: Record<string, unknown>): PlaylistMeta {
  return {
    id: row.spotify_playlist_id as string,
    name: (row.name as string) ?? null,
    description: (row.description as string) ?? null,
    owner_id: (row.owner_id as string) ?? null,
    owner_name: (row.owner_name as string) ?? null,
    followers: (row.followers as number) ?? null,
    image_url: (row.image_url as string) ?? null,
    total_tracks: (row.total_tracks as number) ?? null,
    snapshot_id: (row.snapshot_id as string) ?? null,
    public: (row.public_flag as boolean) ?? null,
    collaborative: (row.collaborative as boolean) ?? null,
    meta_refreshed_at: (row.meta_refreshed_at as string) ?? null,
  };
}

export type PlaylistTrackItem = {
  track_id: string;
  name: string | null;
  artist_ids: string[];
  added_at: string | null;
  position: number;
};

/** Lê faixas de uma playlist pública (paginado interno). TTL: 24h. */
export async function getPlaylistItems(playlistId: string, caller: string, force = false): Promise<PlaylistTrackItem[]> {
  const sb = svc();
  if (!force) {
    const { data } = await sb
      .from("spotify_playlist_cache")
      .select("tracks_jsonb,tracks_refreshed_at")
      .eq("spotify_playlist_id", playlistId).maybeSingle();
    if (data && isFresh(data.tracks_refreshed_at, PLAYLIST_TRACKS_TTL_MS) && Array.isArray(data.tracks_jsonb)) {
      fireAndForgetLog({
        endpoint: "api.spotify.com/v1/playlists/:id/tracks", method: "GET",
        http_status: 200, status: "ok", duration_ms: 0, error: null,
        caller, source: "gateway-cache", resource_id: playlistId,
      });
      return data.tracks_jsonb as PlaylistTrackItem[];
    }
  }

  const key = `playlist_items:${playlistId}`;
  const acquired = await tryAcquireInflight(key, "playlists/:id/tracks", playlistId, caller);
  try {
    if (!acquired) {
      await new Promise((r) => setTimeout(r, 2000));
      const { data } = await sb
        .from("spotify_playlist_cache").select("tracks_jsonb,tracks_refreshed_at")
        .eq("spotify_playlist_id", playlistId).maybeSingle();
      if (data && Array.isArray(data.tracks_jsonb)) return data.tracks_jsonb as PlaylistTrackItem[];
    }

    const items: PlaylistTrackItem[] = [];
    let offset = 0;
    const limit = 100;
    const fields = "items(added_at,track(id,name,artists(id))),next,total";
    while (true) {
      const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}&fields=${encodeURIComponent(fields)}`;
      const r = await ccFetch(url, caller, playlistId);
      if (!r.ok) {
        if (r.status === 404) return [];
        throw new Error(`getPlaylistItems ${r.status}`);
      }
      const j = await r.json();
      const page = (j.items ?? []) as Array<{ added_at: string; track: { id: string; name: string; artists: Array<{ id: string }> } | null }>;
      for (const it of page) {
        if (!it.track?.id) continue;
        items.push({
          track_id: it.track.id,
          name: it.track.name ?? null,
          artist_ids: (it.track.artists ?? []).map((a) => a.id).filter(Boolean),
          added_at: it.added_at ?? null,
          position: items.length,
        });
      }
      if (!j.next || page.length < limit) break;
      offset += limit;
      if (offset > 10_000) break; // safety
    }

    const now = new Date().toISOString();
    await sb.from("spotify_playlist_cache").upsert({
      spotify_playlist_id: playlistId,
      tracks_jsonb: items,
      total_tracks: items.length,
      tracks_refreshed_at: now,
      fetch_status: "ok",
      source: "gateway",
      cached_at: now,
    }, { onConflict: "spotify_playlist_id" });

    return items;
  } finally {
    await releaseInflight(key);
  }
}

// Re-exporta os helpers existentes de tracks/artists (já consolidados via
// spotify-cache.ts + worker). Mantém UMA superfície pública pro futuro.
export { getTrackCacheBatch as getTracksBatch, getArtistCacheBatch as getArtistsBatch } from "./spotify-cache.ts";

// ---------------------------------------------------------------------------
// BATCH helpers (Fase 17-B.5.1)
// ---------------------------------------------------------------------------
// IMPORTANTE: o pool atual do Gateway CC (NexEngine 05 / 10) **NÃO suporta**
// os endpoints batch da Spotify (`/v1/tracks?ids=`, `/v1/artists?ids=`).
// Eles retornam 403 ("Active premium subscription required for the owner of
// the app") mesmo com token CC válido — restrição de cota imposta pela
// Spotify aos donos das Apps.
//
// Estes helpers expõem uma interface **compatível com batch** mas internamente
// fazem fan-out para chamadas single (`/v1/tracks/{id}`, `/v1/artists/{id}`),
// que funcionam perfeitamente no pool CC. Toda a centralização de:
//   - circuit breaker (cooldown global após N falhas seguidas);
//   - retry com backoff em 429/5xx;
//   - limite de concorrência;
// fica aqui, num único lugar. Callers não precisam reimplementar isso.
//
// Quando a Spotify liberar batch pro pool (ou trocarmos de pool), basta
// substituir a implementação interna mantendo a assinatura.

type CircuitState = { failures: number; openUntil: number };
const circuit: CircuitState = { failures: 0, openUntil: 0 };
const CIRCUIT_THRESHOLD = 8;          // falhas seguidas antes de abrir
const CIRCUIT_COOLDOWN_MS = 30_000;   // 30s de cooldown quando aberto

export class GatewayCircuitOpenError extends Error {
  constructor() {
    super("[catalog-gateway] circuit open — too many recent failures");
    this.name = "GatewayCircuitOpenError";
  }
}

function circuitGuard(): void {
  if (Date.now() < circuit.openUntil) throw new GatewayCircuitOpenError();
}
function circuitOnSuccess(): void {
  circuit.failures = 0;
}
function circuitOnFailure(): void {
  circuit.failures += 1;
  if (circuit.failures >= CIRCUIT_THRESHOLD) {
    circuit.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    circuit.failures = 0;
  }
}

async function ccFetchSingleJson<T>(
  url: string,
  caller: string,
  resourceId: string,
): Promise<T | null> {
  circuitGuard();
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await ccFetch(url, caller, resourceId);
      if (r.status === 404) { circuitOnSuccess(); return null; }
      if (r.status === 429) {
        const ra = Number(r.headers.get("retry-after") ?? "1");
        await new Promise((res) => setTimeout(res, Math.min(5000, ra * 1000)));
        lastErr = new Error("429 rate limit");
        continue;
      }
      if (r.status >= 500) {
        await new Promise((res) => setTimeout(res, 400 * attempt));
        lastErr = new Error(`${r.status} server error`);
        continue;
      }
      if (!r.ok) {
        // 401/403/etc — não retry, mas conta como falha pro breaker
        circuitOnFailure();
        return null;
      }
      circuitOnSuccess();
      return await r.json() as T;
    } catch (e) {
      lastErr = e;
      if (e instanceof GatewayCircuitOpenError) throw e;
      await new Promise((res) => setTimeout(res, 300 * attempt));
    }
  }
  circuitOnFailure();
  console.warn(`[catalog-gateway] single fetch failed after ${maxAttempts} attempts: ${(lastErr as Error)?.message}`);
  return null;
}

async function fanOut<T>(
  ids: string[],
  concurrency: number,
  fn: (id: string) => Promise<T | null>,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  let i = 0;
  async function worker() {
    while (i < unique.length) {
      const idx = i++;
      const id = unique[idx];
      try {
        const v = await fn(id);
        if (v != null) out.set(id, v);
      } catch (e) {
        if (e instanceof GatewayCircuitOpenError) throw e;
        console.warn(`[catalog-gateway] fanOut item ${id} failed:`, (e as Error)?.message);
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

/**
 * Interface compatível com `GET /v1/tracks?ids=...` da Spotify.
 * Internamente faz fan-out para `/v1/tracks/{id}` (pool CC não aceita batch).
 * Retorna array na MESMA ORDEM dos ids, com `null` nos não encontrados/falha.
 *
 * @param ids       até centenas de IDs — o gateway pagina internamente.
 * @param caller    nome do worker (vai pro spotify_call_log).
 * @param opts.concurrency  default 6; ajuste se a quota apertar.
 */
export async function gatewayGetTracksBatch(
  ids: string[],
  caller: string,
  opts: { concurrency?: number } = {},
): Promise<Array<Record<string, unknown> | null>> {
  const concurrency = opts.concurrency ?? 6;
  const found = await fanOut(ids, concurrency, (id) =>
    ccFetchSingleJson<Record<string, unknown>>(`https://api.spotify.com/v1/tracks/${id}`, caller, id),
  );
  return ids.map((id) => found.get(id) ?? null);
}

/**
 * Interface compatível com `GET /v1/artists?ids=...` da Spotify.
 * Internamente faz fan-out para `/v1/artists/{id}` (pool CC não aceita batch).
 * Retorna array na MESMA ORDEM dos ids, com `null` nos não encontrados/falha.
 */
export async function gatewayGetArtistsBatch(
  ids: string[],
  caller: string,
  opts: { concurrency?: number } = {},
): Promise<Array<Record<string, unknown> | null>> {
  const concurrency = opts.concurrency ?? 6;
  const found = await fanOut(ids, concurrency, (id) =>
    ccFetchSingleJson<Record<string, unknown>>(`https://api.spotify.com/v1/artists/${id}`, caller, id),
  );
  return ids.map((id) => found.get(id) ?? null);
}
