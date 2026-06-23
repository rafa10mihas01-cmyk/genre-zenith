// Helper de propagação do JWT do portal do curador.
//
// O `CuratorAccessGate` salva no localStorage o JWT emitido por
// `verify-curator-otp`. Toda chamada subsequente a uma função protegida pelo
// gate (`gateCuratorAccess` em `_shared/portal-auth.ts`) PRECISA enviar esse
// JWT no header `x-portal-jwt`, senão o backend responde 401 otp_required e o
// frontend mostra falso "Link inválido ou expirado".
//
// Use `invokeCuratorPortal()` em vez de `supabase.functions.invoke()` para
// qualquer função do portal do curador.
import { supabase } from "@/integrations/supabase/client";

const STORAGE_PREFIX = "curator_access_jwt:";

export function curatorAccessStorageKey(token: string) {
  return `${STORAGE_PREFIX}${token}`;
}

function decodeJwtExpMs(jwt: string): number | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown };
    const expSeconds = Number(decoded?.exp);
    if (!Number.isFinite(expSeconds) || expSeconds <= 0) return null;
    return expSeconds * 1000;
  } catch {
    return null;
  }
}

export function storeCuratorJwt(token: string, jwt: string, email: string) {
  const exp = decodeJwtExpMs(jwt) ?? Date.now() + 86400_000;
  localStorage.setItem(curatorAccessStorageKey(token), JSON.stringify({ jwt, email, exp }));
}

/** Lê o JWT válido do localStorage, ou null se expirado/ausente. */
export function getCuratorJwt(token: string): string | null {
  if (!token) return null;
  try {
    const raw = localStorage.getItem(curatorAccessStorageKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { jwt?: string; exp?: number };
    const jwtExp = parsed?.jwt ? decodeJwtExpMs(parsed.jwt) : null;
    const effectiveExp = jwtExp ?? parsed?.exp;
    if (!parsed?.jwt || !effectiveExp || effectiveExp <= Date.now()) {
      try { localStorage.removeItem(curatorAccessStorageKey(token)); } catch { /* ignore */ }
      return null;
    }
    if (jwtExp && parsed.exp !== jwtExp) {
      try {
        localStorage.setItem(curatorAccessStorageKey(token), JSON.stringify({ ...parsed, exp: jwtExp }));
      } catch { /* ignore */ }
    }
    return parsed.jwt;
  } catch {
    return null;
  }
}

export type InvokeOptions = {
  body?: unknown;
  headers?: Record<string, string>;
};

/**
 * Invoca uma edge function injetando automaticamente o header `x-portal-jwt`
 * quando há JWT salvo para o token do deal.
 */
export async function invokeCuratorPortal<T = unknown>(
  fn: string,
  token: string,
  options: InvokeOptions = {},
) {
  const jwt = getCuratorJwt(token);
  const headers = { ...(options.headers ?? {}) };
  if (jwt) headers["x-portal-jwt"] = jwt;
  return supabase.functions.invoke<T>(fn, {
    body: options.body as Record<string, unknown> | undefined,
    headers,
  });
}
