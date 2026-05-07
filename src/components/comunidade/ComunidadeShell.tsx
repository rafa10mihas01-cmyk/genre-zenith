// Shell exclusivo da Comunidade (membros).
// Sem sidebar. Top mínimo + bottom nav fixa (mobile-first, funciona desktop).
// Vocabulário: parceiro/membro/criador. Nunca "curador".
import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Home, Music2, Award, User as UserIcon, LogOut } from "lucide-react";
import { NexEngineLogo } from "@/components/NexEngineLogo";
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
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top mínimo */}
      <header className="sticky top-0 z-40 h-14 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-2xl items-center justify-between px-4">
          <NavLink to="/comunidade" className="flex items-center gap-2">
            <NexEngineLogo size={22} variant="mark" />
            <span className="text-[14px] font-semibold tracking-tight">Comunidade</span>
          </NavLink>
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
      </header>

      {/* Conteúdo */}
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 py-6 pb-24">{children}</main>

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
