// _shared/spotify.ts — Spotify auth helpers (multi-app aware)
//   - getAppCredentials(appId?) → busca client_id/secret em spotify_apps,
//     com fallback pros env vars (compat retroativo).
//   - getSpotifyToken(): Client Credentials (app-only) — usa app default.
//   - getUserAccessToken(): OAuth user token (refresh automático per-app).
import { createClient } from "npm:@supabase/supabase-js@2";
import { AsyncLocalStorage } from "node:async_hooks";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENV_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID");
const ENV_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET");
const spotifyOriginalFetch = globalThis.fetch.bind(globalThis);

// ---------------------------------------------------------------------------
// Detecção real do function_name no Edge Runtime.
// `SUPABASE_FUNCTION_NAME` NÃO existe — derivamos de Deno.mainModule:
//   file:///home/deno/functions/<name>/index.ts
// ---------------------------------------------------------------------------
function detectFunctionName(): string {
  try {
    const fromEnv = Deno.env.get("SUPABASE_FUNCTION_NAME");
    if (fromEnv) return fromEnv;
    const main = Deno.mainModule ?? "";
    const m = main.match(/\/functions\/([^/]+)\//);
    if (m?.[1]) return m[1];
    const m2 = main.match(/\/([^/]+)\/index\.[tj]sx?$/);
    if (m2?.[1]) return m2[1];
  } catch { /* ignore */ }
  return "unknown";
}
const RESOLVED_FUNCTION_NAME = detectFunctionName();

// Contexto async-local: propaga app_id/owner/playlist_id pra TODAS as chamadas
// fetch() do mesmo callback sem precisar passar ctx manualmente.
export type SpotifyBreakerContext = "operation" | "enrichment";
type CtxFields = {
  appId?: string | null;
  appName?: string | null;
  playlist_id?: string | null;
  owner_id?: string | null;
  spotify_user_id?: string | null;
  function_name?: string | null;
  breaker_context?: SpotifyBreakerContext | null;
};
const ctxStore = new AsyncLocalStorage<CtxFields>();
// Fallback module-level (Deno ALS pode não persistir enterWith em todos cenários).
// Em Edge Runtime cada isolate normalmente atende 1 request por vez, então
// é seguro como fallback de observabilidade. ALS continua sendo preferido.
let __lastCtx: CtxFields = {};

export function withSpotifyCtx<T>(ctx: CtxFields, fn: () => T | Promise<T>): Promise<T> {
  __lastCtx = { ...__lastCtx, ...ctx };
  return Promise.resolve(ctxStore.run({ ...ctx }, fn));
}

function enterCtx(patch: CtxFields): void {
  __lastCtx = { ...__lastCtx, ...patch };
  const cur = ctxStore.getStore();
  if (cur) Object.assign(cur, patch);
  else { try { ctxStore.enterWith({ ...patch }); } catch { /* ignore */ } }
}

/**
 * Define contexto Spotify (playlist_id, owner_id, spotify_user_id) pra TODAS as
 * chamadas subsequentes neste request/loop, sem precisar de wrapper de função.
 * Use após carregar a entidade (ex: managed_playlist) e antes de qualquer
 * getPlaylistMeta / guardedSpotifyFetch / listPlaylistTracksRich.
 */
export function setSpotifyCtx(patch: CtxFields): void {
  enterCtx(patch);
}

const appNameCache = new Map<string, string>();
async function resolveAppName(appId: string | null | undefined): Promise<string | null> {
  if (!appId) return null;
  const cached = appNameCache.get(appId);
  if (cached) return cached;
  try {
    const { data } = await createClient(SUPABASE_URL, SERVICE_KEY)
      .from("spotify_apps").select("name").eq("id", appId).maybeSingle();
    if (data?.name) { appNameCache.set(appId, data.name); return data.name; }
  } catch { /* ignore */ }
  return null;
}

export class SpotifyCircuitOpenError extends Error {
  blockedUntil: string | null;
  retryAfterSec: number;
  constructor(blockedUntil: string | null, retryAfterSec: number) {
    super(`SPOTIFY_CIRCUIT_OPEN: blocked_until=${blockedUntil ?? "unknown"} retry_after=${retryAfterSec}s`);
    this.name = "SpotifyCircuitOpenError";
    this.blockedUntil = blockedUntil;
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Erros de autenticação Spotify — sinalizam que o app atual está com credencial
 * podre OU sem user token. Callers críticos (snapshot, diagnose) podem catch
 * específico pra failover entre apps; demais callers só veem uma exception.
 *
 * Ambos herdam de Error puro (não de SpotifyApiError pra evitar dependência
 * circular com spotify-playlist.ts). Carregam appId + reason pra telemetria.
 */
export class SpotifyAuthInvalidError extends Error {
  appId: string | null;
  reason: "AUTH_INVALID";
  status = 401 as const;
  constructor(appId: string | null, detail = "") {
    super(`SPOTIFY_AUTH_INVALID app=${appId ?? "unknown"}${detail ? ": " + detail.slice(0, 200) : ""}`);
    this.name = "SpotifyAuthInvalidError";
    this.appId = appId;
    this.reason = "AUTH_INVALID";
  }
}

export class SpotifyAuthMissingError extends Error {
  appId: string | null;
  reason: "AUTH_MISSING";
  constructor(appId: string | null, detail = "") {
    super(`SPOTIFY_AUTH_MISSING app=${appId ?? "unknown"}${detail ? ": " + detail : ""}`);
    this.name = "SpotifyAuthMissingError";
    this.appId = appId;
    this.reason = "AUTH_MISSING";
  }
}

// ---------------------------------------------------------------------------
// Helpers de saúde de app — wrappers fail-silent das RPCs criadas na migration.
// Usados pelo guardedSpotifyFetch (hook 401), pelo fetch guard global e pelo
// snapshot-playlist-tracks (failover local).
// ---------------------------------------------------------------------------
type AuthFailureReason = "AUTH_MISSING" | "AUTH_INVALID" | "RATE_LIMIT" | "SPOTIFY_5XX" | "MANUAL";

const __lastResetAt = new Map<string, number>();
const RESET_DEBOUNCE_MS = 60_000;

export async function markAppAuthFailure(
  appId: string | null | undefined,
  reason: AuthFailureReason,
  retryAfterSec?: number | null,
): Promise<void> {
  if (!appId) return;
  try {
    await db().rpc("mark_spotify_app_auth_failure", {
      p_app_id: appId,
      p_reason: reason,
      p_retry_after_sec: retryAfterSec ?? null,
    });
  } catch (e) {
    console.error("[markAppAuthFailure] rpc failed:", (e as Error)?.message ?? String(e));
  }
}

export async function resetAppAuthFailures(appId: string | null | undefined): Promise<void> {
  if (!appId) return;
  const last = __lastResetAt.get(appId) ?? 0;
  if (Date.now() - last < RESET_DEBOUNCE_MS) return;
  __lastResetAt.set(appId, Date.now());
  try {
    await db().rpc("reset_spotify_app_auth_failures", { p_app_id: appId });
  } catch { /* silent */ }
}

function fireAndForget(p: Promise<unknown>): void {
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er?.waitUntil) { try { er.waitUntil(p); } catch { p.catch(() => {}); } }
  else p.catch(() => {});
}

// Escopos necessários pra operação completa da NexEngine:
//   - modify-public/private → adicionar/remover faixas, reordenar, mudar nome/descrição
//   - read-private/collaborative → listar playlists privadas e colaborativas do usuário
//   - ugc-image-upload → trocar capa
//   - user-read-email / user-read-private → identificar conta (display_name, email, country)
export const SPOTIFY_USER_SCOPES_LIST = [
  "playlist-modify-public",
  "playlist-modify-private",
  "playlist-read-private",
  "playlist-read-collaborative",
  "ugc-image-upload",
  "user-read-email",
  "user-read-private",
];
export const SPOTIFY_USER_SCOPES = SPOTIFY_USER_SCOPES_LIST.join(" ");

function db() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

export async function assertSpotifyCircuitClosed(appId = "global"): Promise<void> {
  const supabase = db();
  const effectiveAppId = appId === "global" ? (await getDefaultSpotifyAppId()) ?? "global" : appId;
  try { await supabase.rpc("close_expired_spotify_circuit_breakers"); } catch { /* noop */ }
  const { data, error } = await supabase
    .from("spotify_circuit_breaker")
    .select("status, blocked_until, retry_after_sec")
    .eq("app_id", effectiveAppId)
    .maybeSingle();
  if (error) throw new Error(`spotify_circuit_breaker: ${error.message}`);
  if (data?.status === "open" && data.blocked_until && new Date(data.blocked_until).getTime() > Date.now()) {
    throw new SpotifyCircuitOpenError(data.blocked_until, data.retry_after_sec ?? 0);
  }
}

export async function openSpotifyCircuitBreaker(retryAfterSec?: number | null, appId = "global", causedBy?: string): Promise<{ blockedUntil: string; retryAfterSec: number }> {
  const effectiveAppId = appId === "global" ? (await getDefaultSpotifyAppId()) ?? "global" : appId;
  const safeRetry = Math.max(2, Math.min(Number(retryAfterSec ?? 60), 86_400));
  const blockedUntil = new Date(Date.now() + safeRetry * 1000).toISOString();
  await db().from("spotify_circuit_breaker").upsert({
    app_id: effectiveAppId,
    status: "open",
    blocked_until: blockedUntil,
    last_429_at: new Date().toISOString(),
    retry_after_sec: safeRetry,
  }, { onConflict: "app_id" });
  // Gap 22: registra histórico de cada abertura.
  try {
    await db().from("spotify_circuit_breaker_log").insert({
      app_id: effectiveAppId,
      blocked_until: blockedUntil,
      retry_after_sec: safeRetry,
      caused_by: causedBy ?? null,
      source_function: Deno.env.get("SUPABASE_FUNCTION_NAME") ?? null,
    });
  } catch { /* noop — log opcional */ }
  return { blockedUntil, retryAfterSec: safeRetry };
}


// Endpoints que NÃO devem ser bloqueados pelo circuit breaker.
// accounts.spotify.com/api/token = refresh OAuth (quota separada de Web API).
// Se bloquearmos isso quando breaker abre, tokens expiram e voltamos com 401 em cascata.
function isCircuitBypassUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.hostname === "accounts.spotify.com" && u.pathname === "/api/token") return true;
  } catch { /* ignore */ }
  return false;
}

// ---------------------------------------------------------------------------
// FASE APP-03 — Endpoints de descoberta com quota restrita pelo Spotify
// (Web API mudanças nov/2024). Tratamos 401/403 nesses endpoints como
// "modo degradado" — não geram incidente, não abrem breaker, não marcam
// auth-failure no app. Os consumidores (engine-health, expand-from-winners)
// já tratam ausência desses dados sem quebrar a operação.
// ---------------------------------------------------------------------------
export function isRestrictedDiscoveryEndpoint(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.hostname !== "api.spotify.com") return false;
    // /v1/tracks (catálogo agregado) e /v1/tracks/{id}
    if (u.pathname === "/v1/tracks" || /^\/v1\/tracks\/[A-Za-z0-9]{22}$/.test(u.pathname)) return true;
    // /v1/users/{id}/playlists (descoberta de playlists públicas de usuário)
    if (/^\/v1\/users\/[^/]+\/playlists\/?$/.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Telemetria — log fail-silent em `spotify_call_log`.
// Usado pelo guardedSpotifyFetch e pelo monkey-patch global do fetch.
// Mantém o caller ileso (nunca lança) mas grita no console em falha
// para que problemas de GRANT/RLS apareçam nos edge logs.
// ---------------------------------------------------------------------------
const SPOTIFY_ID_RE_LOG = /[A-Za-z0-9]{22}/g;
function normalizeEndpointForLog(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.hostname}${u.pathname.replace(SPOTIFY_ID_RE_LOG, ":id")}`;
  } catch {
    return rawUrl.slice(0, 200);
  }
}

type SpotifyLogRow = {
  function_name: string | null;
  app_id: string | null;
  app_name: string | null;
  endpoint: string;
  method: string;
  http_status: number | null;
  status: "ok" | "http_error" | "circuit_open" | "exception";
  duration_ms: number;
  retry_after_sec: number | null;
  breaker_open: boolean;
  error: string | null;
  playlist_id?: string | null;
  owner_id?: string | null;
  spotify_user_id?: string | null;
  error_body?: string | null;
};

export type SpotifyCallCtx = {
  appId?: string;
  appName?: string | null;
  playlist_id?: string | null;
  owner_id?: string | null;
  spotify_user_id?: string | null;
  function_name?: string | null;
};

async function writeSpotifyCallLog(row: SpotifyLogRow): Promise<void> {
  try {
    const { error } = await db().from("spotify_call_log").insert(row);
    if (error) {
      console.error("[spotify_call_log] insert failed:", error.message, error.code ?? "");
    }
  } catch (e) {
    console.error("[spotify_call_log] insert threw:", (e as Error)?.message ?? String(e));
  }
}

function fireAndForgetLog(row: SpotifyLogRow): void {
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  // Resolve app_name de forma assíncrona se temos app_id mas não name.
  const enriched = (async () => {
    if (row.app_id && !row.app_name) {
      row.app_name = await resolveAppName(row.app_id);
    }
    await writeSpotifyCallLog(row);
  })();
  if (er?.waitUntil) {
    try { er.waitUntil(enriched); } catch { enriched.catch(() => {}); }
  } else {
    enriched.catch(() => {});
  }
}

/** Merge per-call ctx, async-local ctx, módulo-level fallback e defaults. */
function resolveLogCtx(perCall?: SpotifyCallCtx): Required<Pick<SpotifyLogRow, "function_name" | "app_id" | "app_name" | "playlist_id" | "owner_id" | "spotify_user_id">> {
  // Mescla SEMPRE __lastCtx + ALS store, com ALS por cima quando presente.
  // Antes usávamos `getStore() ?? __lastCtx`, mas ALS no Deno às vezes carrega
  // apenas o patch local do `run()`, perdendo o app_id/appName setado fora dele.
  const als = ctxStore.getStore() ?? {};
  const stored: CtxFields = { ...__lastCtx, ...als };
  return {
    function_name: perCall?.function_name ?? stored.function_name ?? RESOLVED_FUNCTION_NAME,
    app_id: perCall?.appId ?? stored.appId ?? null,
    app_name: perCall?.appName ?? stored.appName ?? null,
    playlist_id: perCall?.playlist_id ?? stored.playlist_id ?? null,
    owner_id: perCall?.owner_id ?? stored.owner_id ?? null,
    spotify_user_id: perCall?.spotify_user_id ?? stored.spotify_user_id ?? null,
  };
}

export async function guardedSpotifyFetch(
  url: string,
  init: RequestInit = {},
  ctxOrAppId: string | SpotifyCallCtx = "global",
): Promise<Response> {
  const ctx: SpotifyCallCtx = typeof ctxOrAppId === "string" ? { appId: ctxOrAppId === "global" ? undefined : ctxOrAppId } : ctxOrAppId;
  const merged = resolveLogCtx(ctx);
  const appId = merged.app_id ?? "global";
  const startedAt = Date.now();
  const method = (init.method ?? "GET").toUpperCase();
  const endpoint = normalizeEndpointForLog(url);
  const bypass = isCircuitBypassUrl(url);
  let logStatus: SpotifyLogRow["status"] = "ok";
  let httpStatus: number | null = null;
  let retryAfterSec: number | null = null;
  let breakerOpen = false;
  let errorMsg: string | null = null;
  let errorBody: string | null = null;
  try {
    if (!bypass) await assertSpotifyCircuitClosed(appId);
    const r = await spotifyOriginalFetch(url, init);
    httpStatus = r.status;
    if (!r.ok) {
      logStatus = "http_error";
      const ra = Number(r.headers.get("Retry-After") ?? r.headers.get("retry-after") ?? "");
      if (Number.isFinite(ra) && ra > 0) retryAfterSec = ra;
      try {
        const clone = r.clone();
        const text = await clone.text();
        if (text) errorBody = text.slice(0, 1000);
      } catch { /* ignore */ }
    }
    // Hook AUTH_INVALID em 401 + reset em 2xx (debounced).
    // FASE APP-03: 401/403 em endpoints restritos NÃO marcam falha de auth
    // (não é problema do app — é restrição de quota do Spotify).
    const restricted = isRestrictedDiscoveryEndpoint(url);
    if (r.status === 401 && !bypass && !restricted && merged.app_id) {
      fireAndForget(markAppAuthFailure(merged.app_id, "AUTH_INVALID"));
    } else if (r.ok && merged.app_id) {
      fireAndForget(resetAppAuthFailures(merged.app_id));
    }
    if (r.status === 429 && !bypass) {
      const ra = Number(r.headers.get("Retry-After") ?? r.headers.get("retry-after") ?? "");
      const opened = await openSpotifyCircuitBreaker(Number.isFinite(ra) && ra > 0 ? ra : 60, appId, url);
      if (merged.app_id) fireAndForget(markAppAuthFailure(merged.app_id, "RATE_LIMIT", opened.retryAfterSec));
      logStatus = "circuit_open";
      breakerOpen = true;
      retryAfterSec = opened.retryAfterSec;
      errorMsg = `429 opened breaker until ${opened.blockedUntil}`;
      throw new SpotifyCircuitOpenError(opened.blockedUntil, opened.retryAfterSec);
    }
    return r;
  } catch (e) {
    if (e instanceof SpotifyCircuitOpenError) {
      logStatus = "circuit_open";
      breakerOpen = true;
      retryAfterSec = retryAfterSec ?? e.retryAfterSec ?? null;
      errorMsg = errorMsg ?? e.message;
    } else if (logStatus === "ok") {
      logStatus = "exception";
      errorMsg = (e as Error)?.message ?? String(e);
    }
    throw e;
  } finally {
    fireAndForgetLog({
      ...merged,
      endpoint,
      method,
      http_status: httpStatus,
      status: logStatus,
      duration_ms: Date.now() - startedAt,
      retry_after_sec: retryAfterSec,
      breaker_open: breakerOpen,
      error: errorMsg,
      error_body: errorBody,
    });
  }
}


export function installSpotifyCircuitFetchGuard() {
  const g = globalThis as typeof globalThis & { __spotifyCircuitFetchGuardInstalled?: boolean };
  if (g.__spotifyCircuitFetchGuardInstalled) return;
  g.__spotifyCircuitFetchGuardInstalled = true;
  g.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    let host = "";
    try { host = new URL(rawUrl).hostname; } catch { /* ignore */ }
    const isSpotify = host === "api.spotify.com" || host === "accounts.spotify.com" || host.endsWith(".spotify.com");
    if (!isSpotify) return spotifyOriginalFetch(input, init);
    const bypass = isCircuitBypassUrl(rawUrl);
    const merged = resolveLogCtx();
    const appId = merged.app_id ?? "global";
    const startedAt = Date.now();
    const method = (init?.method ?? "GET").toUpperCase();
    const endpoint = normalizeEndpointForLog(rawUrl);
    let logStatus: SpotifyLogRow["status"] = "ok";
    let httpStatus: number | null = null;
    let retryAfterSec: number | null = null;
    let breakerOpen = false;
    let errorMsg: string | null = null;
    let errorBody: string | null = null;
    try {
      if (!bypass) await assertSpotifyCircuitClosed(appId);
      const r = await spotifyOriginalFetch(input, init);
      httpStatus = r.status;
      if (!r.ok) {
        logStatus = "http_error";
        const ra = Number(r.headers.get("Retry-After") ?? r.headers.get("retry-after") ?? "");
        if (Number.isFinite(ra) && ra > 0) retryAfterSec = ra;
        try {
          const clone = r.clone();
          const text = await clone.text();
          if (text) errorBody = text.slice(0, 1000);
        } catch { /* ignore */ }
      }
      // Hook AUTH_INVALID: 401 em api.spotify.com (não em accounts) → conta falha do app.
      // FASE APP-03: pula endpoints restritos (descoberta) — 401/403 lá é quota do Spotify, não falha do app.
      const restricted = isRestrictedDiscoveryEndpoint(rawUrl);
      if (r.status === 401 && !bypass && !restricted && merged.app_id) {
        fireAndForget(markAppAuthFailure(merged.app_id, "AUTH_INVALID"));
      } else if (r.ok && merged.app_id) {
        // Sucesso 2xx → reseta contador (debounce 60s pra evitar RPC spam).
        fireAndForget(resetAppAuthFailures(merged.app_id));
      }
      if (r.status === 429 && !bypass) {
        const ra = Number(r.headers.get("Retry-After") ?? r.headers.get("retry-after") ?? "");
        const opened = await openSpotifyCircuitBreaker(Number.isFinite(ra) && ra > 0 ? ra : 60, appId, rawUrl);
        if (merged.app_id) fireAndForget(markAppAuthFailure(merged.app_id, "RATE_LIMIT", opened.retryAfterSec));
        logStatus = "circuit_open";
        breakerOpen = true;
        retryAfterSec = opened.retryAfterSec;
        errorMsg = `429 opened breaker until ${opened.blockedUntil}`;
        throw new SpotifyCircuitOpenError(opened.blockedUntil, opened.retryAfterSec);
      }
      return r;
    } catch (e) {
      if (e instanceof SpotifyCircuitOpenError) {
        logStatus = "circuit_open";
        breakerOpen = true;
        retryAfterSec = retryAfterSec ?? e.retryAfterSec ?? null;
        errorMsg = errorMsg ?? e.message;
      } else if (logStatus === "ok") {
        logStatus = "exception";
        errorMsg = (e as Error)?.message ?? String(e);
      }
      throw e;
    } finally {
      fireAndForgetLog({
        ...merged,
        endpoint,
        method,
        http_status: httpStatus,
        status: logStatus,
        duration_ms: Date.now() - startedAt,
        retry_after_sec: retryAfterSec,
        breaker_open: breakerOpen,
        error: errorMsg,
        error_body: errorBody,
      });
    }
  };
}

installSpotifyCircuitFetchGuard();



export type SpotifyAppCreds = {
  app_id: string | null;
  client_id: string;
  client_secret: string;
  name: string;
};

async function getDefaultSpotifyAppId(): Promise<string | null> {
  const { data } = await db()
    .from("spotify_apps")
    .select("id")
    .eq("status", "active")
    .or("quarantined_until.is.null,quarantined_until.lt." + new Date().toISOString())
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export type GetAppCredentialsOpts = {
  excludeAppIds?: string[];
};

/** Busca credenciais do app Spotify.
 *  - appId informado → carrega esse app (erro se não achar).
 *  - sem appId → expira quarentenas vencidas; escolhe primeiro app `active` AND
 *    não-quarentenado AND não em excludeAppIds (ordem: is_default DESC, created_at ASC).
 *    Se nenhum saudável, faz fallback pra qualquer active (mesmo padrão antigo
 *    pra não derrubar operação em incidente Spotify-wide). Só cai no env como
 *    último recurso quando não há ZERO apps cadastrados.
 */
export async function getAppCredentials(
  appIdOrOpts?: string | null | GetAppCredentialsOpts,
): Promise<SpotifyAppCreds> {
  const sb = db();
  const appId = typeof appIdOrOpts === "string" ? appIdOrOpts : null;
  const opts: GetAppCredentialsOpts = (appIdOrOpts && typeof appIdOrOpts === "object") ? appIdOrOpts : {};
  const excludeAppIds = new Set((opts.excludeAppIds ?? []).filter(Boolean));

  if (appId) {
    const { data, error } = await sb
      .from("spotify_apps")
      .select("id, name, client_id, client_secret, status")
      .eq("id", appId)
      .maybeSingle();
    if (error) throw new Error(`spotify_apps lookup: ${error.message}`);
    if (!data) throw new Error(`App Spotify ${appId} não encontrado`);
    return {
      app_id: data.id,
      name: data.name,
      client_id: data.client_id,
      client_secret: data.client_secret,
    };
  }

  // Expira quarentenas vencidas antes de selecionar (fail-silent, ~5ms).
  try { await sb.rpc("expire_spotify_app_quarantines"); } catch { /* noop */ }

  const nowIso = new Date().toISOString();
  const { data: rows } = await sb
    .from("spotify_apps")
    .select("id, name, client_id, client_secret, is_default, status, quarantined_until")
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  const allActive = (rows ?? []) as Array<{ id: string; name: string; client_id: string; client_secret: string; quarantined_until: string | null }>;
  const healthy = allActive.filter((r) => {
    if (excludeAppIds.has(r.id)) return false;
    if (r.quarantined_until && new Date(r.quarantined_until).getTime() > Date.now()) return false;
    return true;
  });

  // Prioridade: healthy > active (mesmo quarentenado) excluindo excludeAppIds > primeiro active
  const fallback = allActive.filter((r) => !excludeAppIds.has(r.id));
  const picked = healthy[0] ?? fallback[0] ?? allActive[0] ?? null;

  if (picked) {
    return {
      app_id: picked.id,
      name: picked.name,
      client_id: picked.client_id,
      client_secret: picked.client_secret,
    };
  }

  // Fallback final: env vars (compat retroativo)
  if (!ENV_CLIENT_ID || !ENV_CLIENT_SECRET) {
    throw new Error(
      "NO_HEALTHY_SPOTIFY_APP: nenhum app Spotify saudável e SPOTIFY_CLIENT_ID/SECRET não configurados.",
    );
  }
  return {
    app_id: null,
    name: "ENV (legado)",
    client_id: ENV_CLIENT_ID,
    client_secret: ENV_CLIENT_SECRET,
  };
}

export type GetSpotifyTokenOpts = {
  forceRefresh?: boolean;
  excludeAppIds?: string[];
  /** Força usar um app específico (ex.: app do owner da playlist). Bypassa default global. */
  appId?: string | null;
};

/** Versão estendida que retorna também o appId/appName usados. Útil pra failover. */
export async function getSpotifyTokenWithApp(
  opts: GetSpotifyTokenOpts = {},
): Promise<{ token: string; appId: string | null; appName: string }> {
  const supabase = db();
  const creds = opts.appId
    ? await getAppCredentials(opts.appId)
    : await getAppCredentials({ excludeAppIds: opts.excludeAppIds });
  // Propaga app pra TODAS as chamadas Spotify subsequentes neste contexto async.
  enterCtx({ appId: creds.app_id, appName: creds.name });
  if (creds.app_id) appNameCache.set(creds.app_id, creds.name);
  const tokenKey = creds.app_id ? `app:${creds.app_id}` : "app";

  // NOTE: NÃO chamamos assertSpotifyCircuitClosed aqui — refresh de token
  // usa accounts.spotify.com (quota separada) e deve sempre passar.

  if (!opts.forceRefresh) {
    const { data } = await supabase
      .from("spotify_tokens")
      .select("access_token,expires_at")
      .eq("singleton_key", tokenKey)
      .maybeSingle();
    if (data && new Date(data.expires_at).getTime() > Date.now() + 60_000) {
      return { token: data.access_token, appId: creds.app_id, appName: creds.name };
    }
  }

  const basic = btoa(`${creds.client_id}:${creds.client_secret}`);
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
    throw new Error(`Spotify token ${resp.status}: ${t.slice(0, 200)}`);
  }
  const json = await resp.json();
  const access_token: string = json.access_token;
  const expires_at = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();

  await supabase.from("spotify_tokens").upsert(
    { singleton_key: tokenKey, access_token, expires_at, app_id: creds.app_id },
    { onConflict: "singleton_key" },
  );

  return { token: access_token, appId: creds.app_id, appName: creds.name };
}

/** Compat: continua aceitando boolean (forceRefresh) OU opts. Retorna só o token. */
export async function getSpotifyToken(forceRefreshOrOpts: boolean | GetSpotifyTokenOpts = false): Promise<string> {
  const opts: GetSpotifyTokenOpts = typeof forceRefreshOrOpts === "boolean"
    ? { forceRefresh: forceRefreshOrOpts }
    : forceRefreshOrOpts;
  const { token } = await getSpotifyTokenWithApp(opts);
  return token;
}

export type SpotifyUserToken = {
  id: string;
  spotify_user_id: string;
  display_name: string | null;
  email: string | null;
  access_token: string;
  refresh_token: string;
  scope: string | null;
  expires_at: string;
  is_default: boolean;
  app_id: string | null;
};

/** Faz refresh do token de usuário usando o app correto e persiste. */
export async function refreshUserToken(row: SpotifyUserToken): Promise<string> {
  const creds = await getAppCredentials(row.app_id);
  enterCtx({ appId: creds.app_id, appName: creds.name, spotify_user_id: row.spotify_user_id });
  if (creds.app_id) appNameCache.set(creds.app_id, creds.name);
  // NOTE: NÃO chamamos assertSpotifyCircuitClosed — refresh é em accounts.spotify.com (whitelisted).
  const basic = btoa(`${creds.client_id}:${creds.client_secret}`);
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }).toString(),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Spotify refresh ${resp.status} (app=${creds.name}): ${t.slice(0, 200)}`);
  }
  const j = await resp.json();
  const access_token: string = j.access_token;
  const expires_at = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
  const newRefresh: string = j.refresh_token ?? row.refresh_token;

  await db()
    .from("spotify_user_tokens")
    .update({ access_token, refresh_token: newRefresh, expires_at, updated_at: new Date().toISOString() })
    .eq("id", row.id);

  return access_token;
}

/** Retorna access_token de usuário válido (faz refresh se necessário).
 *  Ignora contas vinculadas a apps que não estão `status='active'` (quarentenados/desativados),
 *  exceto se o caller pedir um spotify_user_id que SÓ existe em app não-active —
 *  nesse caso usa mesmo assim e o circuit breaker decide. */
export async function getUserAccessToken(userId?: string): Promise<{ token: string; row: SpotifyUserToken }> {
  const supabase = db();
  const defaultAppId = await getDefaultSpotifyAppId();

  // Lista de apps ativos para filtrar contas em quarentena.
  const { data: activeApps } = await supabase
    .from("spotify_apps")
    .select("id")
    .eq("status", "active");
  const activeAppIds = new Set((activeApps ?? []).map((a: any) => a.id));

  let q = supabase
    .from("spotify_user_tokens")
    .select("*")
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });
  if (userId) q = q.eq("spotify_user_id", userId);
  const { data, error } = await q.limit(userId ? 25 : 1);
  if (error) throw new Error(error.message);
  const allRows = (data ?? []) as SpotifyUserToken[];
  if (allRows.length === 0) throw new Error("Nenhuma conta Spotify conectada. Conecte em Configurações primeiro.");

  // Prefere contas em apps ativos; só cai pra app quarentenado se não houver alternativa.
  const activeRows = allRows.filter((r) => !r.app_id || activeAppIds.has(r.app_id));
  const rows = activeRows.length > 0 ? activeRows : allRows;

  // Prioridade determinística:
  //   1) is_default=true (PRIMARY por owner)
  //   2) defaultAppId global (compat)
  //   3) primeiro da lista (já ordenada por is_default desc, updated_at desc)
  const primary = rows.find((r) => r.is_default === true);
  const row = primary
    ?? (defaultAppId ? rows.find((r) => r.app_id === defaultAppId) : undefined)
    ?? rows[0];
  enterCtx({ appId: row.app_id, spotify_user_id: row.spotify_user_id });
  const expiresMs = new Date(row.expires_at).getTime();
  if (expiresMs > Date.now() + 60_000) return { token: row.access_token, row };
  const fresh = await refreshUserToken(row);
  return { token: fresh, row: { ...row, access_token: fresh } };
}

/** Força refresh imediato do token de usuário (ignora expiry cache). Útil em retry após 401.
 *  Também respeita quarentena (igual getUserAccessToken). */
export async function forceRefreshUserAccessToken(userId: string): Promise<{ token: string; row: SpotifyUserToken }> {
  const supabase = db();
  const defaultAppId = await getDefaultSpotifyAppId();

  const { data: activeApps } = await supabase
    .from("spotify_apps")
    .select("id")
    .eq("status", "active");
  const activeAppIds = new Set((activeApps ?? []).map((a: any) => a.id));

  const { data, error } = await supabase
    .from("spotify_user_tokens")
    .select("*")
    .eq("spotify_user_id", userId)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(25);
  if (error) throw new Error(error.message);
  const allRows = (data ?? []) as SpotifyUserToken[];
  if (allRows.length === 0) throw new Error(`Sem token para spotify_user_id=${userId}`);
  const activeRows = allRows.filter((r) => !r.app_id || activeAppIds.has(r.app_id));
  const rows = activeRows.length > 0 ? activeRows : allRows;
  const primary = rows.find((r) => r.is_default === true);
  const row = primary
    ?? (defaultAppId ? rows.find((r) => r.app_id === defaultAppId) : undefined)
    ?? rows[0];
  const fresh = await refreshUserToken(row);
  return { token: fresh, row: { ...row, access_token: fresh } };
}

