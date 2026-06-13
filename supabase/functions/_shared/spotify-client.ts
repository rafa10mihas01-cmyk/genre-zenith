// _shared/spotify-client.ts
// ---------------------------------------------------------------------------
// FASE 1 — Camada única de acesso à Spotify Web API.
//
// Objetivos desta fase:
//   1. NÃO alterar comportamento de produção. Esta camada é um SHIM em cima de
//      `_shared/spotify.ts` (auth + circuit breaker + monkey-patch fetch).
//   2. Servir como ponto único de instrumentação. Toda chamada feita aqui é
//      registrada em `spotify_call_log` (async, fail-silent).
//   3. Preparar terreno para Fase 2 (multi-app), Fase 3 (rate limiter) e
//      Fase 6 (fila). Para isso a API já aceita `appHint`/`appId`, mesmo que
//      hoje só use o app default.
//
// Comportamento atual (Fase 1):
//   - `fetch(url, init, opts)` chama `guardedSpotifyFetch` do helper legado.
//   - `getToken(opts)` chama `getSpotifyToken` (app default).
//   - Cada chamada loga: function_name, endpoint, method, app, http_status,
//     status (ok|http_error|circuit_open|exception), duration_ms, attempts,
//     retry_after_sec, breaker_open, error.
//
// Próximas fases vão substituir o miolo SEM mudar esta API pública.
// ---------------------------------------------------------------------------

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  getSpotifyToken,
  getUserAccessToken,
  forceRefreshUserAccessToken,
  guardedSpotifyFetch,
  setSpotifyCtx as legacySetSpotifyCtx,
  SpotifyCircuitOpenError,
  type SpotifyUserToken,
} from "./spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_FN_NAME = Deno.env.get("SUPABASE_FUNCTION_NAME") ?? null;

let _sb: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_sb) _sb = createClient(SUPABASE_URL, SERVICE_KEY);
  return _sb;
}

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type SpotifyCallStatus =
  | "ok"
  | "http_error"
  | "circuit_open"
  | "exception";

export type SpotifyCallContext = {
  /** Nome lógico da operação (ex: "search_track", "get_playlist"). Opcional. */
  operation?: string;
  /** Função edge que está chamando. Default: SUPABASE_FUNCTION_NAME. */
  functionName?: string;
  /**
   * Hint de qual app usar. Hoje (Fase 1) é registrado mas IGNORADO no roteamento.
   * Fase 2 vai consumir isso para balancear entre apps.
   */
  appHint?: string | null;
  /** Metadados extras pra debugging (id de recurso, etc). */
  meta?: Record<string, unknown>;
};

export type SpotifyFetchOptions = SpotifyCallContext & {
  /**
   * App ID a usar. Hoje (Fase 1) só é passado para o guard do breaker;
   * o token continua sendo o do app default.
   */
  appId?: string | null;
  /**
   * Campos de observabilidade forwarded ao `guardedSpotifyFetch` legado,
   * enriquecendo `spotify_call_log` por-call (sobrescrevem o ctx armazenado).
   * Mantém paridade com o contrato antigo usado em diagnose-managed-playlist.
   */
  playlist_id?: string | null;
  owner_id?: string | null;
  spotify_user_id?: string | null;
};

// ---------------------------------------------------------------------------
// Normalização de endpoint (para agregação nas métricas)
//   /v1/artists/3foo... → /v1/artists/:id
//   /v1/playlists/4bar.../tracks → /v1/playlists/:id/tracks
// ---------------------------------------------------------------------------

const SPOTIFY_ID_RE = /[A-Za-z0-9]{22}/g;

export function normalizeSpotifyEndpoint(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    // accounts.spotify.com/api/token vs api.spotify.com/v1/...
    const path = u.pathname.replace(SPOTIFY_ID_RE, ":id");
    return `${u.hostname}${path}`;
  } catch {
    return rawUrl.slice(0, 200);
  }
}

// ---------------------------------------------------------------------------
// Logging assíncrono fail-silent
// ---------------------------------------------------------------------------

type LogPayload = {
  function_name: string | null;
  endpoint: string;
  method: string;
  app_id: string | null;
  app_name: string | null;
  http_status: number | null;
  status: SpotifyCallStatus;
  duration_ms: number;
  attempts: number;
  retry_after_sec: number | null;
  breaker_open: boolean;
  error: string | null;
  meta: Record<string, unknown> | null;
};

async function writeCallLog(p: LogPayload): Promise<void> {
  try {
    const { error } = await db().from("spotify_call_log").insert(p);
    if (error) {
      // Loud-fail: aparece nos edge logs sem derrubar o caller.
      console.error("[spotify_call_log] insert failed:", error.message, error.code ?? "");
    }
  } catch (e) {
    console.error("[spotify_call_log] insert threw:", (e as Error)?.message ?? String(e));
  }
}


// Fire-and-forget. Não bloqueia a chamada nem propaga erro.
function logAsync(p: LogPayload): void {
  // EdgeRuntime.waitUntil mantém a Promise viva após o response retornar.
  // Em ambiente local (sem EdgeRuntime), apenas dispara.
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const promise = writeCallLog(p);
  if (er?.waitUntil) {
    try { er.waitUntil(promise); } catch { /* noop */ }
  } else {
    promise.catch(() => { /* swallow */ });
  }
}

// ---------------------------------------------------------------------------
// API pública: fetch instrumentado
// ---------------------------------------------------------------------------

/**
 * Faz uma chamada à Spotify Web API passando pelo circuit breaker existente
 * e registra métricas em `spotify_call_log`.
 *
 * **Fase 1**: comportamento idêntico ao `guardedSpotifyFetch` legado.
 * **Fase 2+**: este ponto vai aplicar roteamento multi-app e rate limit.
 */
export async function spotifyFetch(
  url: string,
  init: RequestInit = {},
  opts: SpotifyFetchOptions = {},
): Promise<Response> {
  const startedAt = Date.now();
  const method = (init.method ?? "GET").toUpperCase();
  const endpoint = normalizeSpotifyEndpoint(url);
  const fnName = opts.functionName ?? DEFAULT_FN_NAME;
  const appIdForGuard = opts.appId ?? "global";

  // Forward de campos de observabilidade ao guardedSpotifyFetch (SpotifyCallCtx).
  // Só monta ctx object quando o caller passou pelo menos um campo enriquecido
  // (playlist_id/owner_id/spotify_user_id/functionName/appId). Caso contrário
  // mantém o atalho string ("global") — preservando merge com setSpotifyCtx.
  const hasRichCtx =
    opts.playlist_id !== undefined ||
    opts.owner_id !== undefined ||
    opts.spotify_user_id !== undefined ||
    opts.functionName !== undefined ||
    opts.appId !== undefined;
  const guardCtx: unknown = hasRichCtx
    ? {
        ...(opts.appId !== undefined ? { appId: opts.appId ?? undefined } : {}),
        ...(opts.playlist_id !== undefined ? { playlist_id: opts.playlist_id } : {}),
        ...(opts.owner_id !== undefined ? { owner_id: opts.owner_id } : {}),
        ...(opts.spotify_user_id !== undefined ? { spotify_user_id: opts.spotify_user_id } : {}),
        ...(opts.functionName !== undefined ? { function_name: opts.functionName } : {}),
      }
    : appIdForGuard;

  let status: SpotifyCallStatus = "ok";
  let httpStatus: number | null = null;
  let retryAfterSec: number | null = null;
  let breakerOpen = false;
  let errorMsg: string | null = null;

  try {
    const r = await guardedSpotifyFetch(url, init, guardCtx as never);
    httpStatus = r.status;
    if (!r.ok) {
      status = "http_error";
      const ra = Number(r.headers.get("retry-after") ?? "");
      if (Number.isFinite(ra) && ra > 0) retryAfterSec = ra;
    }
    return r;
  } catch (e) {
    if (e instanceof SpotifyCircuitOpenError) {
      status = "circuit_open";
      breakerOpen = true;
      retryAfterSec = e.retryAfterSec ?? null;
      errorMsg = e.message;
    } else {
      status = "exception";
      errorMsg = (e as Error)?.message ?? String(e);
    }
    throw e;
  } finally {
    logAsync({
      function_name: fnName,
      endpoint,
      method,
      app_id: opts.appId ?? null,
      app_name: null, // Fase 2 vai preencher quando houver lookup explícito.
      http_status: httpStatus,
      status,
      duration_ms: Date.now() - startedAt,
      attempts: 1,
      retry_after_sec: retryAfterSec,
      breaker_open: breakerOpen,
      error: errorMsg,
      meta: opts.meta ?? (opts.operation ? { operation: opts.operation } : null),
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers de token (re-export instrumentado, mantendo API conhecida)
// ---------------------------------------------------------------------------

/** Client-credentials token (app-only). Fase 1: usa app default. */
export async function getAppToken(_opts: SpotifyCallContext = {}): Promise<string> {
  return await getSpotifyToken();
}

/** Força refresh do app token (client-credentials). Equivalente a getSpotifyToken(true). */
export async function forceRefreshAppToken(_opts: SpotifyCallContext = {}): Promise<string> {
  return await getSpotifyToken(true);
}

/** Token de usuário (OAuth). Mantém assinatura do helper legado. */
export async function getUserToken(
  userId?: string,
): Promise<{ token: string; row: SpotifyUserToken }> {
  return await getUserAccessToken(userId);
}

export async function forceRefreshUserToken(
  userId: string,
): Promise<{ token: string; row: SpotifyUserToken }> {
  return await forceRefreshUserAccessToken(userId);
}

/**
 * Patch do contexto global de logging (spotify_call_log).
 * Re-export do helper legado — permite que callers da camada client
 * enriqueçam o log sem precisar importar `_shared/spotify.ts`.
 */
export const setSpotifyCtx = legacySetSpotifyCtx;

// ---------------------------------------------------------------------------
// Re-exports úteis (evita import cruzado de _shared/spotify.ts nos consumers
// que migrarem para esta camada).
// ---------------------------------------------------------------------------

export {
  SpotifyCircuitOpenError,
  SpotifyAuthInvalidError,
  refreshUserToken,
  getSpotifyTokenWithApp,
  markAppAuthFailure,
} from "./spotify.ts";
export type { SpotifyUserToken } from "./spotify.ts";
