import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { GlobalSearch } from "@/components/GlobalSearch";
import { Bell, HelpCircle } from "lucide-react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="cc-shell min-h-screen flex w-full text-foreground">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* Mobile header — V3 §8.2 */}
          <header
            className="md:hidden sticky top-0 z-50 bg-background/85 backdrop-blur-[10px]"
            style={{
              paddingTop: "calc(env(safe-area-inset-top) + 12px)",
              boxShadow: "0 2px 16px rgba(0,0,0,0.18)",
            }}
          >
            <div className="flex items-center justify-between px-4 pb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
                <div className="relative">
                  <div
                    className="absolute inset-0 blur-md opacity-50 rounded-xl"
                    style={{ background: "radial-gradient(circle, rgba(99,102,241,0.55), transparent 70%)" }}
                  />
                  <div
                    className="relative h-9 w-9 rounded-xl flex items-center justify-center font-display font-bold text-[13px] text-foreground"
                    style={{
                      background: "linear-gradient(135deg, rgba(99,102,241,0.16), rgba(168,85,247,0.11))",
                      border: "1px solid rgba(99,102,241,0.22)",
                    }}
                  >
                    N
                  </div>
                </div>
                <div className="leading-tight">
                  <div
                    className="font-display text-[14px] font-semibold"
                    style={{
                      backgroundImage: "linear-gradient(135deg, hsl(var(--foreground)), #6366f1)",
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                    }}
                  >
                    NexEngine
                  </div>
                  <div className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.20em" }}>
                    Admin
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* Desktop header — V3 §8.1: h-12, transparent, blur-xl */}
          <header className="hidden md:flex h-12 items-center justify-between px-4 border-b border-border bg-background/60 backdrop-blur-xl sticky top-0 z-40">
            <div className="flex items-center gap-3 min-w-0">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground shrink-0" />
              <div className="h-4 w-px bg-border shrink-0" />
              <Breadcrumbs />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <GlobalSearch />
              <button
                className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                title="Ajuda"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
              <button
                className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors relative"
                title="Notificações"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
              </button>
            </div>
          </header>

          <main className="flex-1 py-6 cc-fade-in-up pb-20 md:pb-8">{children}</main>
        </div>

        <MobileBottomNav />
      </div>
    </SidebarProvider>
  );
}
