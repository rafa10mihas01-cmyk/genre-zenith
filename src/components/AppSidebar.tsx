import { NavLink, useLocation } from "react-router-dom";
import { Brain, LogOut, LayoutDashboard, Settings } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = { title: string; url: string; icon: typeof Brain; end?: boolean };

const NAV: NavItem[] = [
  { title: "Visão Geral", url: "/", icon: LayoutDashboard, end: true },
  { title: "Cérebro",     url: "/brain", icon: Brain },
  { title: "Configurações", url: "/settings", icon: Settings },
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
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      {/* Brand */}
      <SidebarHeader className="px-3 py-3.5 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex items-center justify-center font-display font-bold text-primary-foreground shrink-0 bg-primary",
              collapsed ? "h-8 w-8 rounded-lg text-[13px]" : "h-9 w-9 rounded-[10px] text-sm"
            )}
          >
            N
          </div>
          {!collapsed && (
            <div className="leading-tight min-w-0 flex-1">
              <div className="font-display font-semibold text-[14px] tracking-tight truncate text-sidebar-foreground">
                NexEngine
              </div>
              <div
                className="text-[9px] text-muted-foreground uppercase mt-0.5"
                style={{ letterSpacing: "0.20em" }}
              >
                Playlist Intel
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      {/* Nav — lista plana, sem grupos */}
      <SidebarContent className="px-2 py-3">
        <SidebarGroup className="px-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {NAV.map((item) => {
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
                        "h-9 rounded-md transition-colors",
                        "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                        active && "bg-sidebar-accent text-sidebar-foreground font-medium"
                      )}
                    >
                      <NavLink to={item.url} end={item.end} className="flex items-center gap-2.5 w-full px-2">
                        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                        {!collapsed && <span className="text-[13px] truncate">{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer — só user + sair */}
      <SidebarFooter className="border-t border-sidebar-border p-2">
        {user && (
          <div className={cn("flex items-center gap-2 rounded-md p-1.5", !collapsed && "bg-sidebar-accent/40")}>
            <div className="h-7 w-7 rounded-md flex items-center justify-center text-[10px] font-semibold text-primary-foreground bg-primary shrink-0">
              {userInitials(user.email)}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[12px] font-medium text-sidebar-foreground truncate">
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
                className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent shrink-0"
                title="Sair"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        {collapsed && (
          <Button variant="ghost" size="sm" onClick={signOut} className="w-full h-7 px-0 text-muted-foreground hover:text-sidebar-foreground">
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
