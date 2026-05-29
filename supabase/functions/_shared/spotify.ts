// _shared/spotify.ts — Spotify auth helpers (multi-app aware)
//   - getAppCredentials(appId?) → busca client_id/secret em spotify_apps,
//     com fallback pros env vars (compat retroativo).
//   - getSpotifyToken(): Client Credentials (app-only) — usa app default.
//   - getUserAccessToken(): OAuth user token (refresh automático per-app).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENV_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID");
const ENV_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET");
const spotifyOriginalFetch = globalThis.fetch.bind(globalThis);

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
  try { await supabase.rpc("close_expired_spotify_circuit_breakers"); } catch { /* noop */ }
  const { data, error } = await supabase
    .from("spotify_circuit_breaker")
    .select("status, blocked_until, retry_after_sec")
    .eq("app_id", appId)
    .maybeSingle();
  if (error) throw new Error(`spotify_circuit_breaker: ${error.message}`);
  if (data?.status === "open" && data.blocked_until && new Date(data.blocked_until).getTime() > Date.now()) {
    throw new SpotifyCircuitOpenError(data.blocked_until, data.retry_after_sec ?? 0);
  }
}

export async function openSpotifyCircuitBreaker(retryAfterSec?: number | null, appId = "global"): Promise<void> {
  const safeRetry = Math.max(2, Math.min(Number(retryAfterSec ?? 60), 86_400));
  const blockedUntil = new Date(Date.now() + safeRetry * 1000).toISOString();
  await db().from("spotify_circuit_breaker").upsert({
    app_id: appId,
    status: "open",
    blocked_until: blockedUntil,
    last_429_at: new Date().toISOString(),
    retry_after_sec: safeRetry,
  }, { onConflict: "app_id" });
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

export async function guardedSpotifyFetch(url: string, init: RequestInit = {}, appId = "global"): Promise<Response> {
  if (!isCircuitBypassUrl(url)) await assertSpotifyCircuitClosed(appId);
  const r = await spotifyOriginalFetch(url, init);
  if (r.status === 429 && !isCircuitBypassUrl(url)) {
    const ra = Number(r.headers.get("Retry-After") ?? r.headers.get("retry-after") ?? "");
    await openSpotifyCircuitBreaker(Number.isFinite(ra) && ra > 0 ? ra : 60, appId);
  }
  return r;
}

function installSpotifyCircuitFetchGuard() {
  const g = globalThis as typeof globalThis & { __spotifyCircuitFetchGuardInstalled?: boolean };
  if (g.__spotifyCircuitFetchGuardInstalled) return;
  g.__spotifyCircuitFetchGuardInstalled = true;
  g.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    let host = "";
    try { host = new URL(rawUrl).hostname; } catch { /* ignore */ }
    const isSpotify = host === "api.spotify.com" || host === "accounts.spotify.com" || host.endsWith(".spotify.com");
    if (!isSpotify) return spotifyOriginalFetch(input, init);
    // Whitelist: refresh de token NUNCA é bloqueado pelo breaker.
    const bypass = isCircuitBypassUrl(rawUrl);
    if (!bypass) await assertSpotifyCircuitClosed();
    const r = await spotifyOriginalFetch(input, init);
    if (r.status === 429 && !bypass) {
      const ra = Number(r.headers.get("Retry-After") ?? r.headers.get("retry-after") ?? "");
      await openSpotifyCircuitBreaker(Number.isFinite(ra) && ra > 0 ? ra : 60);
    }
    return r;
  };
}

installSpotifyCircuitFetchGuard();

export type SpotifyAppCreds = {
  app_id: string | null;
  client_id: string;
  client_secret: string;
  name: string;
};

/** Busca credenciais do app Spotify.
 *  - appId informado → carrega esse app (erro se não achar).
 *  - sem appId → pega is_default, ou primeiro active, ou cai no env (compat).
 */
export async function getAppCredentials(appId?: string | null): Promise<SpotifyAppCreds> {
  const sb = db();

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

  // sem appId: tenta default → primeiro active
  const { data: def } = await sb
    .from("spotify_apps")
    .select("id, name, client_id, client_secret, is_default, status")
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (def) {
    return {
      app_id: def.id,
      name: def.name,
      client_id: def.client_id,
      client_secret: def.client_secret,
    };
  }

  // Fallback: env vars (compat retroativo enquanto não há apps cadastrados)
  if (!ENV_CLIENT_ID || !ENV_CLIENT_SECRET) {
    throw new Error(
      "Nenhum app Spotify cadastrado e SPOTIFY_CLIENT_ID/SECRET não configurados. " +
      "Cadastre um app em Configurações → Conexões → Spotify.",
    );
  }
  return {
    app_id: null,
    name: "ENV (legado)",
    client_id: ENV_CLIENT_ID,
    client_secret: ENV_CLIENT_SECRET,
  };
}

export async function getSpotifyToken(forceRefresh = false): Promise<string> {
  const supabase = db();

  // NOTE: NÃO chamamos assertSpotifyCircuitClosed aqui — refresh de token
  // usa accounts.spotify.com (quota separada) e deve sempre passar.

  if (!forceRefresh) {
    const { data } = await supabase
      .from("spotify_tokens")
      .select("access_token,expires_at")
      .eq("singleton_key", "app")
      .maybeSingle();
    if (data && new Date(data.expires_at).getTime() > Date.now() + 60_000) {
      return data.access_token;
    }
  }

  const creds = await getAppCredentials();
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
    if (resp.status === 429) {
      const ra = Number(resp.headers.get("Retry-After") ?? "");
      await openSpotifyCircuitBreaker(Number.isFinite(ra) && ra > 0 ? ra : 60);
    }
    throw new Error(`Spotify token ${resp.status}: ${t.slice(0, 200)}`);
  }
  const json = await resp.json();
  const access_token: string = json.access_token;
  const expires_at = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();

  await supabase.from("spotify_tokens").upsert(
    { singleton_key: "app", access_token, expires_at, app_id: creds.app_id },
    { onConflict: "singleton_key" },
  );

  return access_token;
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
async function refreshUserToken(row: SpotifyUserToken): Promise<string> {
  const creds = await getAppCredentials(row.app_id);
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
    if (resp.status === 429) {
      const ra = Number(resp.headers.get("Retry-After") ?? "");
      await openSpotifyCircuitBreaker(Number.isFinite(ra) && ra > 0 ? ra : 60, row.app_id ?? "global");
    }
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

/** Retorna access_token de usuário válido (faz refresh se necessário). */
export async function getUserAccessToken(userId?: string): Promise<{ token: string; row: SpotifyUserToken }> {
  const supabase = db();
  let q = supabase.from("spotify_user_tokens").select("*");
  if (userId) q = q.eq("spotify_user_id", userId);
  else q = q.order("is_default", { ascending: false }).order("updated_at", { ascending: false });
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nenhuma conta Spotify conectada. Conecte em Configurações primeiro.");

  const row = data as SpotifyUserToken;
  await assertSpotifyCircuitClosed(row.app_id ?? "global");
  const expiresMs = new Date(row.expires_at).getTime();
  if (expiresMs > Date.now() + 60_000) return { token: row.access_token, row };
  const fresh = await refreshUserToken(row);
  return { token: fresh, row: { ...row, access_token: fresh } };
}
