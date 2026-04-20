import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { GlobalSearch } from "@/components/GlobalSearch";
import { Bell } from "lucide-react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="cc-shell min-h-screen flex w-full bg-background text-foreground">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* Mobile header */}
          <header
            className="md:hidden sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur"
            style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)" }}
          >
            <div className="flex items-center justify-between px-4 pb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
                <div className="h-8 w-8 rounded-lg flex items-center justify-center font-display font-bold text-[12px] text-primary-foreground bg-primary shrink-0">
                  N
                </div>
                <span className="font-display text-[14px] font-semibold text-foreground">NexEngine</span>
              </div>
              <ThemeToggle />
            </div>
          </header>

          {/* Desktop header */}
          <header className="hidden md:flex h-14 items-center gap-3 px-5 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground shrink-0" />
            <div className="h-4 w-px bg-border shrink-0" />
            <Breadcrumbs />

            <div className="flex-1 flex justify-center">
              <GlobalSearch />
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors relative"
                title="Notificações"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
              </button>
              <ThemeToggle />
            </div>
          </header>

          <main className="flex-1 py-6 cc-anim-enter">{children}</main>
        </div>

        <MobileBottomNav />
      </div>
    </SidebarProvider>
  );
}
