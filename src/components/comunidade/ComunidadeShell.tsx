// Shell exclusivo da Comunidade (membros).
// Mesmo padrão visual da CuratorPage: atmosfera verde difusa, container
// 1200/inner 2xl, topbar compacto (logo + nome + subtítulo), bottom nav fixa.
// Vocabulário: parceiro/membro/criador. Nunca "curador".
import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Home, Music2, Award, User as UserIcon, LogOut } from "lucide-react";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const items = [
  { to: "/comunidade", icon: Home, label: "Início", end: true },
  { to: "/comunidade/campanhas", icon: Music2, label: "Campanhas" },
  { to: "/comunidade/pontos", icon: Award, label: "Pontos" },
  { to: "/comunidade/conta", icon: UserIcon, label: "Conta" },
];

export function ComunidadeShell({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const nav = useNavigate();

  return (
    <div className="relative min-h-screen bg-background text-foreground py-8 sm:py-10 overflow-hidden">
      {/* Atmosfera verde — mesma da CuratorPage */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 hidden dark:block"
        style={{
          background: [
            "radial-gradient(ellipse 70% 45% at 50% 0%, rgba(29,185,84,0.09) 0%, rgba(29,185,84,0) 75%)",
            "radial-gradient(ellipse 45% 55% at 0% 30%, rgba(29,185,84,0.05) 0%, rgba(29,185,84,0) 75%)",
            "radial-gradient(ellipse 45% 55% at 100% 50%, rgba(29,185,84,0.045) 0%, rgba(29,185,84,0) 75%)",
            "radial-gradient(ellipse 75% 35% at 50% 100%, rgba(29,185,84,0.04) 0%, rgba(29,185,84,0) 75%)",
          ].join(", "),
        }}
      />

      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-5 sm:px-6 md:px-8 pb-28">
        <div className="max-w-xl md:max-w-2xl mx-auto space-y-4 sm:space-y-5">
          {/* Topbar — mesmo padrão da CuratorPage */}
          <div className="flex items-center justify-between gap-3 py-2 border-b border-border/50">
            <NavLink to="/comunidade" className="flex items-center gap-2.5 min-w-0">
              <NexEngineLogo variant="mark" size={20} />
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold tracking-tight leading-tight truncate">
                  Comunidade
                </div>
                <div className="text-[10px] text-muted-foreground/60 mt-0.5 leading-none truncate">
                  Campanhas e recompensas em tempo real
                </div>
              </div>
            </NavLink>
            <div className="flex items-center gap-0.5 rounded-lg border border-border/40 bg-card/40 backdrop-blur-sm px-1 py-0.5">
              <ThemeToggle />
              <span className="w-px h-5 bg-border/50" aria-hidden />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={async () => {
                  await signOut();
                  nav("/", { replace: true });
                }}
                aria-label="Sair"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {children}
        </div>
      </div>

      {/* Bottom nav fixa */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur-md"
        aria-label="Navegação principal"
      >
        <div className="mx-auto grid max-w-2xl grid-cols-4">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              <it.icon className="h-[18px] w-[18px]" />
              <span>{it.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
