import { NavLink, useLocation } from "react-router-dom";
import { Home, Brain, Sparkles, BarChart3, Activity, ListMusic } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/cerebro", label: "Cérebro", icon: Brain },
  { to: "/criacao", label: "Criação", icon: Sparkles },
  { to: "/operacao", label: "Operação", icon: Activity },
  { to: "/performance", label: "Performance", icon: BarChart3 },
  { to: "/playlist-deals", label: "Deals", icon: ListMusic },
];

/**
 * Bottom navigation mobile (estilo iOS/Android nativo).
 * - Visível só em <md
 * - Fixa no bottom, respeita safe-area
 * - 5 itens principais; Configurações fica no drawer (hamburger)
 */
export function MobileBottomNav() {
  const location = useLocation();

  return (
    <nav
      className={cn(
        "md:hidden fixed bottom-0 inset-x-0 z-40",
        "bg-card/95 backdrop-blur-xl border-t border-border",
        "pb-[env(safe-area-inset-bottom)]"
      )}
      aria-label="Navegação principal"
    >
      <ul className="flex items-stretch justify-around h-[60px]">
        {items.map((item) => {
          const active = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end={item.end}
                className={cn(
                  "h-full w-full flex flex-col items-center justify-center gap-0.5",
                  "transition-colors duration-150 active:scale-95 transition-transform",
                  "min-h-[44px]",
                  active ? "text-primary" : "text-muted-foreground"
                )}
                aria-label={item.label}
              >
                <Icon
                  className={cn(
                    "h-[22px] w-[22px] transition-transform",
                    active && "scale-110"
                  )}
                  strokeWidth={active ? 2.4 : 2}
                />
                <span
                  className={cn(
                    "text-[10px] leading-none tracking-tight",
                    active ? "font-semibold" : "font-medium"
                  )}
                >
                  {item.label}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
