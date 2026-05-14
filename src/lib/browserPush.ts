/**
 * Browser Push (Notification API nativa do navegador) — usado pelos alertas
 * críticos do sino. Mostra notificação do SO mesmo com a aba em background.
 *
 * Toggle salvo em localStorage. Permission pedida sob demanda no clique.
 */

const LS_KEY = "nx:push:enabled";

export type PushSupport = "supported" | "unsupported" | "denied";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "supported";
}

export function pushEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (pushSupport() !== "supported") return false;
  if (Notification.permission !== "granted") return false;
  return localStorage.getItem(LS_KEY) === "1";
}

export async function enablePush(): Promise<boolean> {
  if (pushSupport() === "unsupported") return false;
  let perm = Notification.permission;
  if (perm === "default") perm = await Notification.requestPermission();
  if (perm !== "granted") return false;
  localStorage.setItem(LS_KEY, "1");
  return true;
}

export function disablePush() {
  localStorage.setItem(LS_KEY, "0");
}

export function showPush(opts: {
  title: string;
  body?: string;
  tag?: string;
  url?: string;
}) {
  if (!pushEnabled()) return;
  // Não duplica se a aba está visível — o toast in-app já cobre.
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
    });
    n.onclick = () => {
      window.focus();
      if (opts.url) {
        if (opts.url.startsWith("http")) window.open(opts.url, "_blank");
        else window.location.href = opts.url;
      }
      n.close();
    };
  } catch {
    /* ignore */
  }
}
