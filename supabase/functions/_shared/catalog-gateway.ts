// Catalog Gateway — ponto único de leitura PÚBLICA da API Spotify.
//
// Fase 17-B.0 (Foundation): este módulo está implementado, mas NENHUM caller
// foi migrado ainda. Ele será adotado por callers em 17-B.1 (process-catalog-
// placements, revalidate-deliveries, sync-managed-playlists).
//
// Princípios:
//   1. Endpoints públicos (tracks/artists/albums/search/public playlists/items)
//      DEVEM passar por aqui. Proibido fetch direto pra esses endpoints
//      em código novo.
//   2. Gateway tenta SEMPRE Client Credentials primeiro. OAuth de App só
//      como fallback quando o recurso exigir (raro pra GET público).
//   3. TTL-aware: lê de spotify_playlist_cache / spotify_track_cache /
//      spotify_artist_cache antes de chamar a API.
//   4. Coalescência: requisições paralelas para o mesmo (endpoint, id) são
//      deduplicadas via catalog_inflight (advisory).
//   5. Toda chamada gera linha em spotify_call_log com meta.source='gateway'
//      para a view catalog_gateway_metrics medir o antes × depois.

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

async function getGatewayCcToken(): Promise<{ token: string; appName: string }> {
  const app = await pickGatewayApp();
  const cached = gatewayTokenCache.get(app.client_id);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return { token: cached.token, appName: cached.appName };
  }
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
  const token: string = j.access_token;
  const expiresAt = Date.now() + ((j.expires_in ?? 3600) * 1000);
  gatewayTokenCache.set(app.client_id, { token, expiresAt, appName: app.name });
  return { token, appName: app.name };
}

// ---------------------------------------------------------------------------
// Fetch com Client Credentials + logging
// ---------------------------------------------------------------------------
async function ccFetch(url: string, caller: string, resourceId?: string): Promise<Response> {
  const startedAt = Date.now();
  const endpoint = normalizeEndpointForLog(url);
  let httpStatus: number | null = null;
  let status: GatewayLog["status"] = "ok";
  let errorMsg: string | null = null;
  try {
    const { token } = await getGatewayCcToken();
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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
