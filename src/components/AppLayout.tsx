import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { Search, Bell } from "lucide-react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="cc-shell cc-force-dark min-h-screen flex w-full">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* ============ MOBILE HEADER ============ */}
          <header
            className="md:hidden sticky top-0 z-50 border-b border-border/50"
            style={{
              background: "hsl(230 35% 4% / 0.85)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              paddingTop: "calc(env(safe-area-inset-top) + 10px)",
            }}
          >
            <div className="flex items-center justify-between px-4 pb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center font-display font-bold text-[12px] text-white shrink-0"
                  style={{
                    background: "linear-gradient(135deg, hsl(231 60% 55%) 0%, hsl(270 65% 58%) 100%)",
                  }}
                >
                  N
                </div>
                <span className="font-display text-[14px] font-semibold text-foreground">NexEngine</span>
              </div>
              <ThemeToggle />
            </div>
          </header>

          {/* ============ DESKTOP HEADER (NexCreatorX-style) ============ */}
          <header
            className="hidden md:flex h-14 items-center gap-3 px-5 border-b border-border/50 sticky top-0 z-40"
            style={{
              background: "hsl(230 35% 4% / 0.75)",
              backdropFilter: "blur(16px) saturate(140%)",
              WebkitBackdropFilter: "blur(16px) saturate(140%)",
            }}
          >
            <SidebarTrigger className="text-muted-foreground hover:text-foreground shrink-0" />
            <div className="h-4 w-px bg-border shrink-0" />
            <Breadcrumbs />

            <div className="flex-1 flex justify-center">
              <div className="nx-search">
                <Search className="h-3.5 w-3.5 shrink-0" />
                <input placeholder="Buscar tudo..." disabled />
                <span className="nx-kbd">⌘K</span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors relative"
                title="Notificações"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(0_72%_60%)]" />
              </button>
              <ThemeToggle />
            </div>
          </header>

          <main className="flex-1 py-6 cc-anim-enter">{children}</main>

          {/* Badge NEXENGINE no canto */}
          <div
            className="hidden md:flex fixed bottom-3 right-4 items-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-semibold tracking-[0.18em] uppercase text-muted-foreground/60 pointer-events-none z-10"
            style={{ background: "hsl(230 25% 7% / 0.6)", border: "1px solid hsl(230 15% 14% / 0.6)" }}
          >
            <span className="h-1 w-1 rounded-full bg-[hsl(231_60%_55%)]" />
            NEXENGINE
          </div>
        </div>

        <MobileBottomNav />
      </div>
    </SidebarProvider>
  );
}
