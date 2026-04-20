import { NavLink, useLocation } from "react-router-dom";
import { Brain, LogOut, Sparkles } from "lucide-react";
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
  /** RGB triplet for accent square + glow on hover */
  accent: string;
};

const items: NavItem[] = [
  { title: "Cérebro", url: "/", icon: Brain, end: true, accent: "99,102,241" }, // indigo
];

function userInitials(email?: string | null) {
  if (!email) return "??";
  const name = email.split("@")[0];
  return name.slice(0, 2).toUpperCase();
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { signOut, user } = useAuth();
  const location = useLocation();

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border bg-sidebar"
    >
      {/* ============ HEADER — logo 48×48 ring indigo + glow ============ */}
      <SidebarHeader className="px-3 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div className="relative shrink-0">
            <div
              className="absolute inset-0 -m-1 rounded-xl blur-md opacity-60"
              style={{
                background:
                  "radial-gradient(circle, rgba(99,102,241,0.55) 0%, transparent 70%)",
              }}
              aria-hidden
            />
            <div
              className={cn(
                "relative flex items-center justify-center font-display font-bold text-white",
                collapsed ? "h-9 w-9 rounded-lg text-sm" : "h-12 w-12 rounded-xl text-lg"
              )}
              style={{
                background:
                  "linear-gradient(135deg, rgba(99,102,241,0.22) 0%, rgba(168,85,247,0.16) 100%)",
                border: "1px solid rgba(99,102,241,0.40)",
                boxShadow:
                  "0 0 0 1px rgba(99,102,241,0.20), 0 0 24px rgba(99,102,241,0.25), inset 0 1px 0 rgba(255,255,255,0.10)",
              }}
            >
              <Sparkles className={collapsed ? "h-4 w-4" : "h-5 w-5"} />
            </div>
          </div>
          {!collapsed && (
            <div className="leading-tight min-w-0">
              <div className="font-display font-semibold text-md tracking-tight truncate text-sidebar-foreground">
                NexEngine
              </div>
              <div
                className="text-[10px] text-muted-foreground uppercase mt-0.5"
                style={{ letterSpacing: "0.18em" }}
              >
                Inteligência
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      {/* ============ NAV ============ */}
      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase font-medium text-muted-foreground px-2 mb-1" style={{ letterSpacing: "0.08em" }}>
              Navegação
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((item) => {
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
                        "h-9 px-2 rounded-md transition-colors group",
                        "hover:bg-sidebar-accent/60",
                        active && "bg-sidebar-accent text-sidebar-accent-foreground"
                      )}
                    >
                      <NavLink
                        to={item.url}
                        end={item.end}
                        className="flex items-center gap-2.5"
                      >
                        {/* ícone colorido 6×6 (24px) rounded-md */}
                        <div
                          className={cn(
                            "h-6 w-6 rounded-md flex items-center justify-center shrink-0 transition-all",
                            active ? "shadow-sm" : "opacity-90 group-hover:opacity-100"
                          )}
                          style={{
                            background: active
                              ? `linear-gradient(135deg, rgba(${item.accent},0.30), rgba(${item.accent},0.15))`
                              : `rgba(${item.accent},0.12)`,
                            border: `1px solid rgba(${item.accent},${active ? 0.45 : 0.22})`,
                            boxShadow: active
                              ? `0 0 12px rgba(${item.accent},0.25)`
                              : undefined,
                          }}
                        >
                          <Icon
                            className="h-3.5 w-3.5"
                            style={{ color: `rgba(${item.accent},1)` }}
                          />
                        </div>
                        {!collapsed && (
                          <span className="text-sm font-medium truncate">
                            {item.title}
                          </span>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* ============ FOOTER — user card + logout ============ */}
      <SidebarFooter className="border-t border-sidebar-border p-2 space-y-1.5">
        {user && (
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-md p-1.5",
              !collapsed && "bg-sidebar-accent/40"
            )}
          >
            <div
              className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
                boxShadow: "0 0 0 1px rgba(99,102,241,0.30), 0 0 10px rgba(168,85,247,0.20)",
              }}
            >
              {userInitials(user.email)}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-xs font-medium text-sidebar-foreground truncate">
                  {user.email?.split("@")[0]}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {user.email}
                </div>
              </div>
            )}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 h-8 text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60"
          onClick={signOut}
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </Button>
        {!collapsed && (
          <div className="text-[9px] text-muted-foreground/50 text-center pt-1" style={{ letterSpacing: "0.1em" }}>
            v1.0.0
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
