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

/** Lê o JWT válido do localStorage, ou null se expirado/ausente. */
export function getCuratorJwt(token: string): string | null {
  if (!token) return null;
  try {
    const raw = localStorage.getItem(curatorAccessStorageKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { jwt?: string; exp?: number };
    if (!parsed?.jwt || !parsed?.exp || parsed.exp <= Date.now()) {
      try { localStorage.removeItem(curatorAccessStorageKey(token)); } catch { /* ignore */ }
      return null;
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
