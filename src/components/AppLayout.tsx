import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Zap } from "lucide-react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center border-b border-border bg-card/40 backdrop-blur sticky top-0 z-30 px-3 gap-2">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <ThemeToggle />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span>NexEngine</span>
              <span className="opacity-40">/</span>
              <span className="opacity-70">Motor de Inteligência</span>
            </div>
          </header>
          <main className="flex-1 p-6 animate-fade-in">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
