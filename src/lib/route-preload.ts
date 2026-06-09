// Preload de chunks lazy ao passar mouse sobre item de menu.
// O browser/Vite deduplicam — chamar import() duas vezes baixa uma única vez.
// Quando o usuário clica, o módulo já está em cache → Suspense resolve sem flicker.

export const preloadRoute: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/Home"),
  "/clientes": () => import("@/pages/Clientes"),
  "/curadores": () => import("@/pages/Prospecao"),
  "/prospeccao": () => import("@/pages/Prospecao"),
  "/campanhas": () => import("@/pages/Campanhas"),
  "/financeiro": () => import("@/pages/Financeiro"),
  "/catalogo": () => import("@/pages/Operacao"),
  "/playlists": () => import("@/pages/Operacao"),
  "/analytics": () => import("@/pages/Analytics"),
  "/performance": () => import("@/pages/Performance"),
  "/valuation": () => import("@/pages/Valuation"),
  "/sistema": () => import("@/pages/Sistema"),
  "/deals": () => import("@/pages/PlaylistDeals"),
};

export function preloadFor(url: string): void {
  const key = url.split("?")[0];
  preloadRoute[key]?.();
}
