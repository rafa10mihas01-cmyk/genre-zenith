// Classificação de cada rota: "context" (lembra estado) ou "flow" (reseta ao reabrir).
// TTL controla por quanto tempo o estado em memória/sessionStorage é considerado válido.
// Match é por prefixo — a chave mais específica vence.

export type ScreenKind = "context" | "flow";

export type ScreenConfig = {
  kind: ScreenKind;
  /** ms — 0 = sempre reseta. */
  ttl: number;
};

const MIN = 60_000;

const REGISTRY: Record<string, ScreenConfig> = {
  "/": { kind: "context", ttl: 5 * MIN },
  "/cerebro": { kind: "context", ttl: 5 * MIN },
  "/criacao": { kind: "context", ttl: 2 * MIN },
  "/catalogo": { kind: "context", ttl: 2 * MIN },
  "/performance": { kind: "context", ttl: 2 * MIN },
  "/playlist-deals": { kind: "context", ttl: 2 * MIN },
  "/curadores": { kind: "context", ttl: 2 * MIN },
  "/sistema": { kind: "context", ttl: 1 * MIN },
  "/comunidade-admin": { kind: "context", ttl: 2 * MIN },
  "/comunidade": { kind: "context", ttl: 2 * MIN },
  "/comunidade/onboarding": { kind: "flow", ttl: 0 },
  "/comunidade/join": { kind: "flow", ttl: 0 },
};

const DEFAULT: ScreenConfig = { kind: "context", ttl: 2 * MIN };

export function getScreenConfig(pathname: string): ScreenConfig {
  const match = Object.keys(REGISTRY)
    .filter((k) => (k === "/" ? pathname === "/" : pathname === k || pathname.startsWith(k + "/")))
    .sort((a, b) => b.length - a.length)[0];
  return match ? REGISTRY[match] : DEFAULT;
}

export function isFlowRoute(pathname: string): boolean {
  return getScreenConfig(pathname).kind === "flow";
}
