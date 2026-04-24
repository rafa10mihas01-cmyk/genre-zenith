import { NavLink, useLocation } from "react-router-dom";
import { Home, Brain, Sparkles, BarChart3, Settings, LogOut, Activity, Monitor } from "lucide-react";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SidebarSmartPanel } from "@/components/SidebarSmartPanel";

// Módulos do sistema. Padrão fixo, escalável.
// `adminOnly` esconde o item para quem não é admin.
const items = [
  { title: "Home", url: "/", icon: Home, end: true },
  { title: "Cérebro", url: "/cerebro", icon: Brain },
  { title: "Criação", url: "/criacao", icon: Sparkles },
  { title: "Operação", url: "/operacao", icon: Activity },
  { title: "Performance", url: "/performance", icon: BarChart3 },
  { title: "Sistema", url: "/sistema", icon: Monitor },
  { title: "Configurações", url: "/configuracoes", icon: Settings, adminOnly: true },
];

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const { signOut, user } = useAuth();
  const { isAdmin } = useUserRole();
  const location = useLocation();
  const visibleItems = items.filter((i) => !i.adminOnly || isAdmin);

  // Fecha o drawer mobile ao escolher um item — comportamento app-like
  const handleNav = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      {/* Header da sidebar: altura idêntica ao topbar (h-14).
          Usamos apenas o mark "N" — o logo completo tem subtítulo em corpo muito pequeno
          que vira ilegível em qualquer tamanho razoável de header. */}
      <SidebarHeader className="h-14 px-4 border-b border-sidebar-border flex flex-row items-center gap-2.5">
        <button
          type="button"
          onClick={handleNav}
          className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-md hover:opacity-80 transition-opacity"
          aria-label="Fechar menu"
        >
          <NexEngineLogo
            size={collapsed ? 24 : 28}
            variant="mark"
            className={cn(collapsed && "mx-auto")}
          />
          {!collapsed && (
            <span className="text-[15px] font-bold tracking-tight text-sidebar-foreground leading-none">
              NexEngine
            </span>
          )}
        </button>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {visibleItems.map((item) => {
                const active = item.end
                  ? location.pathname === item.url
                  : location.pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      className={cn(
                        "h-9 rounded-md transition-colors relative",
                        "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
                        active && "bg-sidebar-accent !text-sidebar-foreground font-medium",
                      )}
                    >
                      <NavLink to={item.url} end={item.end} onClick={handleNav} className="flex items-center gap-3 px-3">
                        {/* Barra verde à esquerda quando ativo (estilo Spotify) */}
                        {active && !collapsed && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-primary" />
                        )}
                        <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-sidebar-foreground/60")} />
                        {!collapsed && <span className="text-[14px]">{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Painel inteligente: KPIs contextuais + Quick Actions + Alertas */}
      <SidebarSmartPanel />

      {/* Footer: uma linha só, avatar + nome + botão sair inline (estilo Spotify) */}
      <SidebarFooter className="border-t border-sidebar-border p-2">
        {collapsed ? (
          <Button
            variant="ghost"
            size="icon"
            className="w-full h-9 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
            onClick={signOut}
            aria-label="Sair"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        ) : (
          <div className="flex items-center gap-2 px-2 h-10 rounded-md hover:bg-sidebar-accent/40 transition-colors group">
            {user && (
              <>
                <div className="h-7 w-7 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                  {(user.email ?? "U").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate text-sidebar-foreground leading-tight">
                    {user.email?.split("@")[0]}
                  </div>
                </div>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-sidebar-foreground/50 hover:text-sidebar-foreground opacity-60 group-hover:opacity-100 transition-opacity"
              onClick={signOut}
              aria-label="Sair"
              title="Sair"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
