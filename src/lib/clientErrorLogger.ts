// FASE 4.C.2 — RUM logger frontend.
// Captura window.onerror + unhandledrejection e despacha (via fetch keepalive)
// ao edge `log-client-error`. Inclui correlation_id se o usuário tiver um
// armazenado no sessionStorage (definido pelos hooks que recebem header).

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/log-client-error`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const RELEASE = (import.meta.env.VITE_APP_RELEASE as string) ?? "dev";
const SESSION_KEY = "nx:last_correlation_id";

let installed = false;

function postError(payload: Record<string, unknown>) {
  try {
    const body = JSON.stringify({
      ...payload,
      release: RELEASE,
      url: typeof location !== "undefined" ? location.href : null,
      correlation_id: sessionStorage.getItem(SESSION_KEY) ?? null,
    });
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch { /* swallow — never break UI */ }
}

export function installClientErrorLogger() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (ev) => {
    postError({
      message: ev.message ?? "Unknown error",
      stack: ev.error?.stack ?? null,
      source: ev.filename ?? null,
      lineno: ev.lineno ?? null,
      colno: ev.colno ?? null,
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    postError({
      message: typeof r === "string" ? r : (r?.message ?? "unhandled_rejection"),
      stack: r?.stack ?? null,
      source: "unhandledrejection",
    });
  });
}

export function rememberCorrelationId(id: string) {
  try { sessionStorage.setItem(SESSION_KEY, id); } catch { /* ignore */ }
}
