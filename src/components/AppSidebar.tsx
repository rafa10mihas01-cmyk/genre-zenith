import { NavLink, useLocation } from "react-router-dom";
import {
  Brain, LogOut, Sparkles, LayoutDashboard, Layers, Tag,
  Activity, ScrollText, Settings, Plus, HelpCircle, ChevronRight,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = {
  title: string;
  url: string;
  icon: typeof Brain;
  end?: boolean;
  /** HSL hue for accent square */
  hue: number;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const groups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { title: "Visão Geral", url: "/", icon: LayoutDashboard, end: true, hue: 231 },
      { title: "Cérebro",     url: "/brain", icon: Brain, hue: 270 },
    ],
  },
  {
    label: "Inteligência",
    items: [
      { title: "Modelos", url: "/models", icon: Layers, hue: 217 },
      { title: "Gêneros", url: "/genres", icon: Tag, hue: 152 },
    ],
  },
  {
    label: "Operação",
    items: [
      { title: "Coletor", url: "/collect", icon: Activity, hue: 38 },
      { title: "Logs",    url: "/logs", icon: ScrollText, hue: 0 },
    ],
  },
  {
    label: "Sistema",
    items: [
      { title: "Configurações", url: "/settings", icon: Settings, hue: 230 },
    ],
  },
];

function userInitials(email?: string | null) {
  if (!email) return "??";
  return email.split("@")[0].slice(0, 2).toUpperCase();
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { signOut, user } = useAuth();
  const location = useLocation();

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border"
      style={{ background: "hsl(230 30% 5%)" }}
    >
      {/* ============ HEADER — logo NexEngine ============ */}
      <SidebarHeader className="px-3 py-3.5 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "relative flex items-center justify-center font-display font-bold text-white shrink-0",
              collapsed ? "h-8 w-8 rounded-lg text-[13px]" : "h-9 w-9 rounded-[10px] text-sm"
            )}
            style={{
              background: "linear-gradient(135deg, hsl(231 60% 55%) 0%, hsl(270 65% 58%) 100%)",
              boxShadow: "0 0 0 1px hsl(231 60% 55% / 0.25), 0 8px 20px -8px hsl(231 60% 55% / 0.5)",
            }}
          >
            N
          </div>
          {!collapsed && (
            <div className="leading-tight min-w-0 flex-1">
              <div className="font-display font-semibold text-[14px] tracking-tight truncate text-foreground">
                NexEngine
              </div>
              <div className="text-[9px] text-muted-foreground uppercase mt-0.5" style={{ letterSpacing: "0.20em" }}>
                Playlist Intel
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      {/* ============ NAV ============ */}
      <SidebarContent className="px-2 py-3 gap-4">
        {groups.map((g) => (
          <SidebarGroup key={g.label} className="px-0">
            {!collapsed && (
              <SidebarGroupLabel className="nx-group-label px-2 mb-1.5 h-auto">
                {g.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {g.items.map((item) => {
                  const active = item.end
                    ? location.pathname === item.url
                    : location.pathname.startsWith(item.url);
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        className={cn(
                          "h-8 px-1.5 rounded-md transition-colors group",
                          "hover:bg-sidebar-accent/60",
                          active && "bg-sidebar-accent"
                        )}
                      >
                        <NavLink to={item.url} end={item.end} className="flex items-center gap-2.5 w-full">
                          <div
                            className="nx-accent-square h-5 w-5"
                            style={{
                              background: active
                                ? `hsl(${item.hue} 65% 58% / 0.18)`
                                : `hsl(${item.hue} 50% 50% / 0.08)`,
                              borderColor: active
                                ? `hsl(${item.hue} 65% 58% / 0.40)`
                                : `hsl(${item.hue} 50% 50% / 0.18)`,
                            }}
                          >
                            <Icon
                              className="h-3 w-3"
                              style={{ color: `hsl(${item.hue} 70% ${active ? 70 : 60}%)` }}
                            />
                          </div>
                          {!collapsed && (
                            <>
                              <span className={cn(
                                "text-[13px] truncate flex-1",
                                active ? "font-medium text-foreground" : "text-muted-foreground"
                              )}>
                                {item.title}
                              </span>
                              {active && <ChevronRight className="h-3 w-3 text-muted-foreground/60" />}
                            </>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* ============ FOOTER — quick actions + user + logout ============ */}
      <SidebarFooter className="border-t border-sidebar-border p-2 gap-1">
        {!collapsed && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 h-8 text-[12px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60"
              onClick={() => window.location.assign("/brain")}
            >
              <Plus className="h-3.5 w-3.5" /> Nova análise
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 h-8 text-[12px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60"
            >
              <HelpCircle className="h-3.5 w-3.5" /> Ajuda & Suporte
            </Button>
            <div className="h-px bg-sidebar-border my-1" />
          </>
        )}

        {user && (
          <div className={cn("flex items-center gap-2 rounded-md p-1.5", !collapsed && "bg-sidebar-accent/30")}>
            <div
              className="h-7 w-7 rounded-md flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
              style={{
                background: "linear-gradient(135deg, hsl(231 60% 55%) 0%, hsl(270 65% 58%) 100%)",
              }}
            >
              {userInitials(user.email)}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[12px] font-medium text-foreground truncate">
                  {user.email?.split("@")[0]}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  Administrador
                </div>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={signOut}
                className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 shrink-0"
                title="Sair"
              >
                <LogOut className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        {collapsed && (
          <Button variant="ghost" size="sm" onClick={signOut} className="w-full h-7 px-0 text-muted-foreground hover:text-foreground">
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
