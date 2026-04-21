import { ReactNode, useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Bell, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { timeAgo } from "@/lib/format";
import { useNavigate } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Layout global do sistema. Toda página renderizada DEVE estar dentro dele.
 * - Sidebar fixa à esquerda
 * - Topbar com busca + status "atualizado há X" + sino + nav back/forward
 * - Padding/spacing consistente para todo conteúdo (px-8 py-6, max-w livre)
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const nav = useNavigate();

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
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {/* TOPBAR GLOBAL — todas as páginas herdam */}
          <header className="h-14 flex items-center gap-3 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-30 px-4">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
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

            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar gêneros, playlists, artistas..."
                className="pl-9 h-9 bg-elevated border-border rounded-full text-sm focus-visible:ring-1 focus-visible:ring-primary/40"
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <div className="hidden sm:inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-elevated border border-border text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                {lastUpdate ? `Atualizado ${timeAgo(lastUpdate)}` : "Aguardando dados"}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={refresh}
                className="rounded-full h-8 gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Atualizar</span>
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground" aria-label="Notificações">
                <Bell className="h-4 w-4" />
                <span className="sr-only">Notificações</span>
              </Button>
            </div>
          </header>

          {/* CONTEÚDO — padding consistente em todas as páginas */}
          <main className="flex-1 px-6 lg:px-8 py-6 animate-fade-in nx-scroll">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
