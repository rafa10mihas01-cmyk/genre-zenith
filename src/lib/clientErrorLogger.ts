// FASE 4.C.3 — RUM avançado (breadcrumbs, rota, ação, componente, viewport, sessão).
// Mantém compat com 4.C.2 (mesmo endpoint, mesmas chaves antigas continuam funcionando).

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/log-client-error`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const RELEASE = (import.meta.env.VITE_APP_RELEASE as string) ?? "dev";
const COMMIT = (import.meta.env.VITE_APP_COMMIT as string) ?? "dev";
const SESSION_KEY = "nx:last_correlation_id";
const SESSION_START_KEY = "nx:session_start";

type Crumb = {
  t: number;        // epoch ms
  kind: string;     // nav | click | fetch | console | custom
  msg: string;
  meta?: Record<string, unknown>;
};

const MAX_CRUMBS = 30;
const breadcrumbs: Crumb[] = [];
let installed = false;
let routeFrom: string | null = null;
let routeTo: string | null = (typeof location !== "undefined") ? location.pathname : null;
let lastAction: string | null = null;
let lastComponent: string | null = null;

function pushCrumb(c: Crumb) {
  breadcrumbs.push(c);
  if (breadcrumbs.length > MAX_CRUMBS) breadcrumbs.shift();
}

function sessionStartMs(): number {
  try {
    const v = sessionStorage.getItem(SESSION_START_KEY);
    if (v) return parseInt(v, 10);
    const now = Date.now();
    sessionStorage.setItem(SESSION_START_KEY, String(now));
    return now;
  } catch { return Date.now(); }
}

function viewport(): string | null {
  if (typeof window === "undefined") return null;
  return `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio ?? 1}`;
}

function postError(payload: Record<string, unknown>) {
  try {
    const start = sessionStartMs();
    const body = JSON.stringify({
      ...payload,
      release: RELEASE,
      commit_sha: COMMIT,
      url: typeof location !== "undefined" ? location.href : null,
      route_from: routeFrom,
      route_to: routeTo,
      user_action: lastAction,
      component: lastComponent,
      viewport: viewport(),
      session_ms: Date.now() - start,
      breadcrumbs: breadcrumbs.slice(-MAX_CRUMBS),
      correlation_id: sessionStorage.getItem(SESSION_KEY) ?? null,
    });
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch { /* swallow */ }
}

export function installClientErrorLogger() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  sessionStartMs();

  // Navegação (SPA)
  const wrap = (k: "pushState" | "replaceState") => {
    const orig = history[k];
    history[k] = function (...args: any[]) {
      const from = location.pathname;
      const r = orig.apply(this, args as any);
      const to = location.pathname;
      if (from !== to) {
        routeFrom = from;
        routeTo = to;
        pushCrumb({ t: Date.now(), kind: "nav", msg: `${from} → ${to}` });
      }
      return r;
    } as any;
  };
  wrap("pushState"); wrap("replaceState");
  window.addEventListener("popstate", () => {
    const to = location.pathname;
    if (routeTo !== to) {
      routeFrom = routeTo;
      routeTo = to;
      pushCrumb({ t: Date.now(), kind: "nav", msg: `popstate → ${to}` });
    }
  });

  // Cliques (captura básica)
  window.addEventListener("click", (ev) => {
    const el = ev.target as HTMLElement | null;
    if (!el) return;
    const label =
      el.getAttribute("data-track") ||
      el.getAttribute("aria-label") ||
      (el.tagName === "BUTTON" ? el.textContent?.slice(0, 40) : null) ||
      el.tagName.toLowerCase();
    lastAction = `click:${label}`;
    pushCrumb({ t: Date.now(), kind: "click", msg: String(label ?? "") });
  }, { capture: true, passive: true });

  // Erros JS
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
    const r: any = ev.reason;
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

/** Pra componentes registrarem ação de domínio (ex: "submit:NovoDeal"). */
export function trackUserAction(action: string, component?: string) {
  lastAction = action;
  if (component) lastComponent = component;
  pushCrumb({ t: Date.now(), kind: "custom", msg: action, meta: component ? { component } : undefined });
}

/** Pra ErrorBoundary informar componente que quebrou. */
export function setActiveComponent(name: string | null) {
  lastComponent = name;
}
