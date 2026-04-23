import { ReactNode, useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { timeAgo } from "@/lib/format";
import { useNavigate, useLocation } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { SidebarContextProvider } from "@/contexts/SidebarContext";
import { NotificationsBell } from "@/components/NotificationsBell";
import { MobileBottomNav } from "@/components/MobileBottomNav";

// Mapa de rótulos curtos para o título no header mobile
const ROUTE_TITLES: Record<string, string> = {
  "/": "Cockpit",
  "/cerebro": "Cérebro",
  "/criacao": "Criação",
  "/operacao": "Operação",
  "/performance": "Performance",
  "/configuracoes": "Configurações",
};
function getRouteTitle(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  const match = Object.keys(ROUTE_TITLES)
    .filter((k) => k !== "/" && pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_TITLES[match] : "NexEngine";
}

/**
 * Layout global do sistema. Toda página renderizada DEVE estar dentro dele.
 * - Sidebar fixa à esquerda
 * - Topbar com busca + status "atualizado há X" + sino + nav back/forward
 * - Padding/spacing consistente para todo conteúdo (px-8 py-6, max-w livre)
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const nav = useNavigate();
  const location = useLocation();
  const pageTitle = getRouteTitle(location.pathname);

  // Puxa "última atividade global" pra exibir no topbar (dado real, não fake)
  const refresh = async () => {
    const { data } = await supabase
      .from("collection_logs")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastUpdate(data?.created_at ?? null);
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <SidebarProvider>
      <SidebarContextProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 shadow-[-1px_0_0_rgba(255,255,255,0.04)]">
          {/* TOPBAR GLOBAL — todas as páginas herdam (sempre fixo, nunca some) */}
          <header className="h-14 min-h-14 max-h-14 flex items-center gap-3 border-b border-border bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 sticky top-0 z-50 px-4 transition-none">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            {/* Mobile: logo + título dinâmico (estilo app nativo) */}
            <div className="md:hidden flex items-center gap-2 min-w-0">
              <NexEngineLogo size={24} variant="mark" />
              <span className="text-[15px] font-semibold text-foreground truncate">
                {pageTitle}
              </span>
            </div>
            <div className="hidden md:flex items-center gap-1">
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

            <div className="relative flex-1 min-w-0 max-w-md hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar gêneros, playlists, artistas..."
                className="pl-9 h-9 bg-elevated border-border rounded-full text-sm focus-visible:ring-1 focus-visible:ring-primary/40"
              />
            </div>
            {/* Spacer mobile para empurrar ações para a direita */}
            <div className="flex-1 sm:hidden" />

            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <div className="hidden sm:inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-elevated border border-border text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                {lastUpdate ? `Atualizado ${timeAgo(lastUpdate)}` : "Aguardando dados"}
              </div>
              <Button
                size="sm"
                variant="premium"
                onClick={refresh}
                className="rounded-full h-8 gap-1.5 hidden sm:inline-flex"
                aria-label="Atualizar"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Atualizar</span>
              </Button>
              <ThemeToggle />
              <NotificationsBell />
            </div>
          </header>

          {/* CONTEÚDO — padding consistente em todas as páginas */}
          <main className="relative flex-1 nx-scroll min-h-[calc(100vh-3.5rem)]">
            {/* Gradiente sutil no topo: verde Spotify difuso → transparente */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-[420px] z-0"
              style={{
                background:
                  "radial-gradient(ellipse 80% 60% at 50% 0%, hsl(141 76% 48% / 0.10) 0%, hsl(141 76% 48% / 0.04) 30%, transparent 70%)",
              }}
            />
            <div className="nx-page relative z-10">{children}</div>
          </main>
        </div>
        {/* Bottom nav fixa apenas no mobile */}
        <MobileBottomNav />
      </div>
      </SidebarContextProvider>
    </SidebarProvider>
  );
}
