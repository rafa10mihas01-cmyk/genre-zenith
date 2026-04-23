import { NavLink, useLocation } from "react-router-dom";
import { Home, Brain, Sparkles, BarChart3, Settings, LogOut, Activity } from "lucide-react";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Módulos do sistema. Padrão fixo, escalável.
// `adminOnly` esconde o item para quem não é admin.
const items = [
  { title: "Home", url: "/", icon: Home, end: true },
  { title: "Cérebro", url: "/cerebro", icon: Brain },
  { title: "Criação", url: "/criacao", icon: Sparkles },
  { title: "Operação", url: "/operacao", icon: Activity },
  { title: "Performance", url: "/performance", icon: BarChart3 },
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
      <SidebarHeader className="px-4 py-6 border-b border-sidebar-border">
        <div className={cn("flex items-center w-full", collapsed ? "justify-center" : "justify-start")}>
          <NexEngineLogo size={collapsed ? 32 : 56} variant="auto" />
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
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
                        "h-10 rounded-lg transition-colors",
                        "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                        active && "bg-sidebar-accent text-sidebar-foreground font-semibold",
                      )}
                    >
                      <NavLink to={item.url} end={item.end} onClick={handleNav} className="flex items-center gap-3 px-3">
                        <item.icon className={cn("h-[18px] w-[18px] shrink-0", active && "text-primary")} />
                        {!collapsed && <span className="text-sm">{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3 space-y-2">
        {!collapsed && user && (
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="h-8 w-8 rounded-full bg-elevated border border-border flex items-center justify-center text-xs font-bold text-foreground shrink-0">
              {(user.email ?? "U").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="text-xs font-medium truncate text-sidebar-foreground">{user.email?.split("@")[0]}</div>
              <div className="text-[10px] text-sidebar-foreground/50">Conectado</div>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Sair</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
