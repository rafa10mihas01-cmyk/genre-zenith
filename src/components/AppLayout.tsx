import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="cc-shell cc-force-dark min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {/* ============ MOBILE HEADER (sticky, safe-area) ============ */}
          <header
            className="md:hidden sticky top-0 z-50 bg-background/85 backdrop-blur-[10px] border-b border-border/40"
            style={{
              paddingTop: "calc(env(safe-area-inset-top) + 12px)",
              boxShadow: "0 2px 16px rgba(0,0,0,0.18)",
            }}
          >
            <div className="flex items-center justify-between px-4 pb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Logo glass indigo + halo */}
                <div className="relative shrink-0">
                  <div
                    className="absolute inset-0 -m-1 rounded-xl blur-md opacity-50"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(99,102,241,0.55) 0%, transparent 70%)",
                    }}
                  />
                  <div
                    className="relative h-9 w-9 rounded-xl flex items-center justify-center font-display font-bold text-sm text-white"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(99,102,241,0.16) 0%, rgba(168,85,247,0.11) 100%)",
                      border: "1px solid rgba(99,102,241,0.22)",
                    }}
                  >
                    N
                  </div>
                </div>
                <div className="flex flex-col min-w-0">
                  <span
                    className="font-display text-md font-semibold leading-none bg-clip-text text-transparent"
                    style={{
                      backgroundImage:
                        "linear-gradient(135deg, hsl(var(--foreground)) 0%, #6366f1 100%)",
                    }}
                  >
                    NexEngine
                  </span>
                  <span
                    className="text-[10px] uppercase mt-1 text-muted-foreground"
                    style={{ letterSpacing: "0.20em" }}
                  >
                    ADMIN
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <ThemeToggle />
                <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
              </div>
            </div>
          </header>

          {/* ============ DESKTOP HEADER (48px, blur-xl) ============ */}
          <header className="hidden md:flex h-12 items-center justify-between px-4 border-b border-border/60 bg-background/60 backdrop-blur-xl sticky top-0 z-40">
            <div className="flex items-center gap-3 min-w-0">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground shrink-0" />
              <div className="h-4 w-px bg-border shrink-0" />
              <Breadcrumbs />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <ThemeToggle />
            </div>
          </header>

          <main className="flex-1 cc-anim-enter">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
