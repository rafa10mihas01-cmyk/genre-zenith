// Helpers compartilhados de sessão do Portal do Cliente.
// Centraliza:
//  - leitura/escrita do JWT cacheado
//  - detecção confiável de localStorage (Safari privado, in-app browser de
//    WhatsApp/Gmail/Instagram costumam bloquear ou jogar quota_exceeded)
//  - log de diagnóstico (portal_auth_debug) — fire-and-forget
//
// Erros de auth do portal são tratados em UM ÚNICO lugar (handlePortalAuthError)
// pra garantir que NUNCA renderizemos dashboard parcial zerado: ou os dados
// chegam completos, ou exibimos "Sessão expirada".

import { supabase } from "@/integrations/supabase/client";

export type PortalAuthError =
  | "auth_required"
  | "invalid_session"
  | "wrong_campaign";

const PORTAL_AUTH_ERRORS: ReadonlySet<string> = new Set<PortalAuthError>([
  "auth_required",
  "invalid_session",
  "wrong_campaign",
]);

export function isPortalAuthError(err: unknown): err is PortalAuthError {
  return typeof err === "string" && PORTAL_AUTH_ERRORS.has(err);
}

export function portalStorageKey(token: string): string {
  return `campaign_access_jwt:${token}`;
}

/** True se conseguimos ler E escrever em window.localStorage. */
export function isLocalStorageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const k = "__nx_ls_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function getPortalJwt(token: string | undefined): string | null {
  if (!token) return null;
  if (!isLocalStorageAvailable()) return null;
  try {
    const raw = localStorage.getItem(portalStorageKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { jwt?: string; exp?: number };
    if (parsed?.jwt && parsed?.exp && parsed.exp > Date.now()) return parsed.jwt;
  } catch { /* ignore */ }
  return null;
}

export function portalHeaders(token: string | undefined): Record<string, string> {
  const jwt = getPortalJwt(token);
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

export function clearPortalSession(token: string | undefined): void {
  if (!token) return;
  try { localStorage.removeItem(portalStorageKey(token)); } catch { /* ignore */ }
}

/** Log diagnóstico fire-and-forget (não bloqueia UI, não quebra se falhar). */
export function logPortalAuth(payload: {
  campaign_id?: string | null;
  email?: string | null;
  endpoint: string;
  auth_status: string;
  jwt_present: boolean;
  localstorage_available: boolean;
  token?: string | null;
}): void {
  try {
    void supabase.functions.invoke("portal-auth-debug", {
      body: {
        ...payload,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        timestamp: new Date().toISOString(),
      },
    });
  } catch { /* ignore */ }
}
