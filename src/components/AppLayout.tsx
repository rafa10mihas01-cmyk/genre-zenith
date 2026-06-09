import { ReactNode, useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { SidebarContextProvider } from "@/contexts/SidebarContext";
import { NotificationsBell } from "@/components/NotificationsBell";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { CommandPalette } from "@/components/CommandPalette";
import { TopProgressBar } from "@/components/TopProgressBar";
import { cn } from "@/lib/utils";
// SplashLoader é montado UMA vez em App.tsx (fora do AppLayout) pra cobrir
// rotas públicas e o boot inteiro. Não duplicar aqui.
import { AppFooter } from "@/components/AppFooter";
import { ExecutionFreezeBanner } from "@/components/ExecutionFreezeBanner";

// Mapa de rótulos curtos para o título no header mobile/tablet
const ROUTE_TITLES: Record<string, string> = {
  "/": "Início",
  
  "/catalogo": "Catálogo",
  "/performance": "Performance",
  "/playlist-deals": "Negociações",
  "/sistema": "Sistema",
  "/configuracoes": "Configurações",
};
function getRouteTitle(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  const match = Object.keys(ROUTE_TITLES)
    .filter((k) => k !== "/" && pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_TITLES[match] : "NexEngine";
}

// Rotas que rodam em modo fullscreen — sem max-width do nx-page nem padding lateral.
// Cockpits operacionais ocupam toda a área útil e controlam o próprio scroll.
const FULLSCREEN_ROUTES = [/^\/playlists\/[^/]+$/, /^\/campanhas\/[^/]+\/execucao$/];
function isFullscreenRoute(pathname: string): boolean {
  return FULLSCREEN_ROUTES.some((rx) => rx.test(pathname));
}

/**
 * Layout global do sistema. Toda página renderizada DEVE estar dentro dele.
 * - Sidebar fixa à esquerda
 * - Topbar com busca + status "atualizado há X" + sino + nav back/forward
 * - Padding/spacing consistente para todo conteúdo (px-8 py-6, max-w livre)
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const nav = useNavigate();
  const location = useLocation();
  const pageTitle = getRouteTitle(location.pathname);
  const fullscreen = isFullscreenRoute(location.pathname);

  // Atalho global ⌘K / Ctrl+K — abre Command Palette de qualquer lugar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Trava global dos trilhos de abas: vertical wheel/trackpad não rola a página
  // quando o cursor está em cima das tabs; somente gesto horizontal mexe o trilho.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const rail = (e.target as Element | null)?.closest?.(".nx-tab-rail, .nx-tabs-scroll") as HTMLElement | null;
      if (!rail) return;

      const vertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX);
      if (vertical && !e.shiftKey) {
        e.preventDefault();
        return;
      }

      if (Math.abs(e.deltaX) > 0) {
        e.preventDefault();
        rail.scrollLeft += e.deltaX;
      }
    };

    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => document.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  return (
    <SidebarProvider>
      <SidebarContextProvider>
      {/* Loading global: barra fina no topo. Splash já está em App.tsx. */}
      <TopProgressBar />

      <div className="min-h-dvh flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 h-dvh overflow-hidden shadow-[-1px_0_0_rgba(255,255,255,0.04)]">

          {/* TOPBAR GLOBAL — fixo fora da área de scroll. Mobile: cobre safe-area/notch. */}
          <header
            className="shrink-0 flex items-center gap-2 lg:gap-3 border-b border-border z-50 px-3 md:px-4 transition-none w-full min-w-0 overflow-hidden
              h-14 min-h-14 max-h-14
              bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75
              max-lg:h-14 max-lg:min-h-14 max-lg:max-h-14
              max-lg:pt-[env(safe-area-inset-top,0px)]
              max-lg:bg-background/85 max-lg:backdrop-blur-[10px]
              max-lg:shadow-[0_1px_0_hsl(var(--border)),0_6px_16px_-12px_rgba(0,0,0,0.5)]"
          >
            <SidebarTrigger className="shrink-0 text-muted-foreground hover:text-foreground" />

            {/* Tablet/Mobile: voltar + logo + título dinâmico (estilo app nativo) */}
            <div className="lg:hidden flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
              {location.pathname !== "/" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 -ml-1 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => nav(-1)}
                  aria-label="Voltar"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              )}
              <NexEngineLogo size={24} variant="mark" className="shrink-0" />
              <span className="text-[15px] font-semibold text-foreground truncate min-w-0">
                {pageTitle}
              </span>
            </div>

            {/* Desktop: navegação back/forward */}
            <div className="hidden lg:flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full bg-elevated/60 text-muted-foreground hover:text-foreground"
                onClick={() => nav(-1)}
                aria-label="Voltar"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full bg-elevated/60 text-muted-foreground hover:text-foreground"
                onClick={() => nav(1)}
                aria-label="Avançar"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Busca rápida (⌘K) — apenas desktop, expande livre */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Buscar (⌘K)"
              className="hidden lg:flex items-center gap-2 flex-1 min-w-0 max-w-md h-9 px-3 rounded-full bg-elevated border border-border text-sm text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1 text-left">
                <span className="hidden lg:inline">Buscar gêneros, páginas, ações...</span>
                <span className="lg:hidden">Buscar...</span>
              </span>
              <kbd className="hidden lg:inline-flex items-center gap-0.5 px-1.5 h-5 rounded bg-background border border-border text-[10px] font-mono text-muted-foreground/70">
                ⌘K
              </kbd>
            </button>

            <div className="ml-auto flex items-center gap-1 shrink-0 min-w-0">
              {/* Lupa tablet/mobile — abre Command Palette */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setPaletteOpen(true)}
                aria-label="Buscar"
                className="lg:hidden h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-elevated/60 shrink-0"
              >
                <Search className="h-[18px] w-[18px]" />
              </Button>
              <ThemeToggle />
              <NotificationsBell />
            </div>
          </header>

          <ExecutionFreezeBanner />

          {/* CONTEÚDO — só ele rola */}
          <main className={cn(
            "relative flex-1 min-h-0 overflow-x-hidden overscroll-contain nx-scroll",
            fullscreen ? "overflow-hidden" : "overflow-y-auto",
          )}>
            {/* Gradiente sutil no topo: verde Spotify difuso → transparente */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-[420px] z-0"
              style={{
                background:
                  "radial-gradient(ellipse 80% 60% at 50% 0%, hsl(141 76% 48% / 0.10) 0%, hsl(141 76% 48% / 0.04) 30%, transparent 70%)",
              }}
            />
            <div className={fullscreen ? "relative z-10 w-full h-full min-h-0" : "nx-page relative z-10 flex flex-col lg:min-h-full"}>
              {children}
              {!fullscreen && <div className="mt-auto hidden lg:block"><AppFooter /></div>}
            </div>
          </main>
        </div>
        {/* Bottom nav fixa apenas no mobile */}
        <MobileBottomNav />
        {/* Command Palette global (⌘K) — busca + navegação rápida */}
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
      </SidebarContextProvider>
    </SidebarProvider>
  );
}
