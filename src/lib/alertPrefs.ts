/**
 * Preferências de alerta — quais domínios silenciar e severidade mínima
 * para disparar toast/push. Persistidas em localStorage por navegador.
 *
 * Crítico nunca pode ser silenciado (segurança operacional).
 */
import type { NotificationDomain, NotificationType } from "@/hooks/useNotifications";

const LS_KEY = "nx:alert:prefs";

export interface AlertPrefs {
  mutedDomains: NotificationDomain[];
  /** Severidade mínima para toast/push. "critical" = só críticos, "warning" = warning+critical, "info" = tudo. */
  minSeverity: NotificationType;
}

const DEFAULT: AlertPrefs = { mutedDomains: [], minSeverity: "warning" };

export function getAlertPrefs(): AlertPrefs {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Partial<AlertPrefs>;
    return {
      mutedDomains: Array.isArray(p.mutedDomains) ? (p.mutedDomains as NotificationDomain[]) : [],
      minSeverity: (p.minSeverity ?? "warning") as NotificationType,
    };
  } catch {
    return DEFAULT;
  }
}

export function setAlertPrefs(p: AlertPrefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(p));
  window.dispatchEvent(new CustomEvent("nx:alert-prefs-changed"));
}

const SEV_RANK: Record<NotificationType, number> = { info: 0, warning: 1, critical: 2 };

/**
 * Decide se um alerta deve disparar notificação ativa (toast/push).
 * Crítico SEMPRE passa, ignorando prefs (regra de segurança).
 */
export function passesAlertPrefs(
  type: NotificationType,
  domain: NotificationDomain | undefined,
): boolean {
  if (type === "critical") return true;
  const prefs = getAlertPrefs();
  if (domain && prefs.mutedDomains.includes(domain)) return false;
  return SEV_RANK[type] >= SEV_RANK[prefs.minSeverity];
}
