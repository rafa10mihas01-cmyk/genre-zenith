import { NavLink, useLocation } from "react-router-dom";
import {
  Home, Sparkles, BarChart3, Settings, LogOut, ListMusic, Handshake,
  Server, Target, ChevronRight, User, Brain, UserSearch, Wallet, Library,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton,
  SidebarMenuSubItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SidebarSmartPanel } from "@/components/SidebarSmartPanel";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { preloadFor } from "@/lib/route-preload";

/**
 * Sidebar reorganizada (Fase A do plano de reorganização).
 *
 * 4 grupos enxutos + submenus contextuais que só expandem quando o grupo está ativo:
 *  - Cockpit (Início)
 *  - Operação (Campanhas, Playlist Deals, Playlists)
 *  - Inteligência (Inteligência, Analytics)
 *  - Admin (Infra, Comunidade)  — só para admin
 *
 * Configurações foi movido para o rodapé (ícone gear ao lado do logout).
 * Nenhuma rota antiga foi removida; todas continuam acessíveis via alias em App.tsx.
 */
type SubItem = { title: string; url: string; end?: boolean };
type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
  children?: SubItem[];
  /** Outras rotas que devem marcar este item como ativo (aliases legados). */
  matchPaths?: string[];
  accent?: string;
};
type NavSection = { label: string; items: NavItem[] };

const sections: NavSection[] = [
  {
    label: "Cockpit",
    items: [
      { title: "Início", url: "/", icon: Home, end: true, accent: "domain-system" },
    ],
  },
  {
    label: "Operação",
    items: [
      {
        title: "Clientes",
        url: "/clientes",
        icon: User,
      },
      {
        title: "Curadores",
        url: "/curadores",
        icon: UserSearch,
        matchPaths: ["/prospeccao"],
      },
      // Comunidade oculto do sidebar — acessível via Curadores (comunidade/prospecção).
      // {
      //   title: "Comunidade",
      //   url: "/comunidade-admin",
      //   icon: Users,
      //   adminOnly: true,
      //   matchPaths: ["/comunidade", "/comunidade/campanhas", "/comunidade/pontos", "/comunidade/conta"],
      //   accent: "domain-community",
      // },
      { title: "Campanhas", url: "/campanhas", icon: Target, accent: "domain-campaigns" },
      { title: "Catálogo", url: "/catalogo", icon: Library, accent: "domain-playlists" },
      { title: "Financeiro", url: "/financeiro", icon: Wallet, accent: "domain-deals" },
      // Deals oculto do sidebar — acessível via Campanhas (aprovação/deals).
      // {
      //   title: "Deals",
      //   url: "/deals",
      //   icon: Handshake,
      //   matchPaths: ["/playlist-deals", "/deals/comparar"],
      //   accent: "domain-deals",
      // },


      {
        title: "Playlists",
        url: "/operacao",
        icon: ListMusic,
        matchPaths: ["/playlists"],
      },
    ],
  },
  {
    label: "Inteligência",
    items: [
      {
        title: "Analytics",
        url: "/analytics",
        icon: BarChart3,
        matchPaths: ["/inteligencia", "/cerebro", "/criacao", "/performance", "/valuation", "/benchmarks", "/matriz", "/heatmap"],
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        title: "Sistema",
        url: "/sistema",
        icon: Server,
        adminOnly: true,
        matchPaths: ["/infra", "/infraestrutura", "/admin/aprendizado"],
      },
    ],
  },
];

function itemIsActive(item: NavItem, pathname: string, search: string): boolean {
  const [itemPath, itemQuery] = item.url.split("?");
  const currentParams = new URLSearchParams(search);
  const matchQuery = (q?: string) => {
    if (!q) return true;
    const expected = new URLSearchParams(q);
    for (const [k, v] of expected) if (currentParams.get(k) !== v) return false;
    return true;
  };
  if (item.end) return pathname === itemPath && matchQuery(itemQuery);
  // Se o item tem query string, precisa bater path + query
  if (itemQuery) {
    return (pathname === itemPath || pathname.startsWith(itemPath + "/")) && matchQuery(itemQuery);
  }
  if (pathname === itemPath || pathname.startsWith(itemPath + "/")) return true;
  return (item.matchPaths ?? []).some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

function subIsActive(sub: SubItem, pathname: string, search: string): boolean {
  const [subPath, subQuery] = sub.url.split("?");
  if (pathname !== subPath && !pathname.startsWith(subPath + "/")) return false;
  if (!subQuery) return true;
  const current = new URLSearchParams(search);
  const expected = new URLSearchParams(subQuery);
  for (const [k, v] of expected) if (current.get(k) !== v) return false;
  return true;
}

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const { signOut, user } = useAuth();
  const { isAdmin } = useUserRole();
  const location = useLocation();
  const visibleSections = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.adminOnly || isAdmin) }))
    .filter((s) => s.items.length > 0);

  const handleNav = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
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

      <SidebarContent className="px-2 py-2">
        {visibleSections.map((section, idx) => (
          <SidebarGroup key={section.label} className={cn("p-0", idx > 0 && "mt-4")}>
            {!collapsed && (
              <SidebarGroupLabel className="h-6 px-3 mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-sidebar-foreground/80">
                {section.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {section.items.map((item) => {
                  const active = itemIsActive(item, location.pathname, location.search);
                  const hasChildren = !!item.children?.length;

                  // Item simples (sem filhos)
                  if (!hasChildren) {
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          className={cn(
                            "h-9 rounded-lg transition-colors relative",
                            "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
                            active && "!bg-card border border-sidebar-border rounded-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] !text-foreground font-medium",
                          )}
                        >
                          <NavLink to={item.url} end={item.end} onClick={handleNav} onMouseEnter={() => preloadFor(item.url)} onFocus={() => preloadFor(item.url)} className="flex items-center gap-3 px-3">
                            <item.icon
                              className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-sidebar-foreground/60")}
                            />
                            {!collapsed && <span className="text-[14px]">{item.title}</span>}
                            {active && !collapsed && (
                              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(29,185,84,0.6)]" />
                            )}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  }

                  // Item com submenu: colapsável, abre auto quando o grupo está ativo.
                  // Quando a sidebar está colapsada, vira link direto (sem submenu).
                  if (collapsed) {
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.title}
                          className={cn(
                            "h-9 rounded-lg transition-colors relative",
                            "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
                            active && "!bg-card border border-sidebar-border rounded-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] !text-foreground",
                          )}
                        >
                          <NavLink to={item.url} onClick={handleNav} onMouseEnter={() => preloadFor(item.url)} onFocus={() => preloadFor(item.url)} className="flex items-center justify-center px-3">
                            <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-sidebar-foreground/60")} />
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  }

                  return (
                    <Collapsible key={item.title} defaultOpen={active} className="group/collapsible">
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            isActive={active}
                            className={cn(
                              "h-9 rounded-lg transition-colors relative w-full",
                              "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
                              active && "!bg-card border border-sidebar-border rounded-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] !text-foreground font-medium",
                            )}
                          >
                            <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-sidebar-foreground/60")} />
                            <span className="text-[14px] flex-1 text-left">{item.title}</span>
                            {active && (
                              <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(29,185,84,0.6)]" />
                            )}
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub className="border-sidebar-border/60">
                            {item.children!.map((sub) => {
                              const subActive = subIsActive(sub, location.pathname, location.search);
                              return (
                                <SidebarMenuSubItem key={sub.url}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={subActive}
                                    className={cn(
                                      "h-8 text-[13px]",
                                      "text-sidebar-foreground/60 hover:text-sidebar-foreground",
                                      subActive && "!text-sidebar-foreground font-medium bg-sidebar-accent/60",
                                    )}
                                  >
                                    <NavLink to={sub.url} end={sub.end} onClick={handleNav}>
                                      <span>{sub.title}</span>
                                    </NavLink>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <div className="mt-auto bg-sidebar-accent/40 border-t border-sidebar-border">
        <SidebarSmartPanel />
        <SidebarFooter className="border-t border-sidebar-border/30 p-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="w-full h-9 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
              aria-label="Configurações"
            >
              <NavLink to="/configuracoes" onClick={handleNav}>
                <Settings className="h-4 w-4" />
              </NavLink>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="w-full h-9 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
              aria-label="Perfil"
            >
              <NavLink to="/configuracoes" onClick={handleNav}>
                <User className="h-4 w-4" />
              </NavLink>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="w-full h-9 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
              onClick={signOut}
              aria-label="Sair"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
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
            {isAdmin && (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-sidebar-foreground/50 hover:text-sidebar-foreground opacity-60 group-hover:opacity-100 transition-opacity"
                aria-label="Configurações"
                title="Configurações"
              >
                <NavLink to="/configuracoes" onClick={handleNav}>
                  <Settings className="h-3.5 w-3.5" />
                </NavLink>
              </Button>
            )}
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-sidebar-foreground/50 hover:text-sidebar-foreground opacity-60 group-hover:opacity-100 transition-opacity"
              aria-label="Perfil"
              title="Perfil"
            >
              <NavLink to="/configuracoes" onClick={handleNav}>
                <User className="h-3.5 w-3.5" />
              </NavLink>
            </Button>
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
      </div>
    </Sidebar>
  );
}
