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
 * Bottom navigation premium estilo YouTube/Instagram/Spotify.
 * - Visível em <xl (mobile + tablet)
 * - Safe-area iOS (notch / home indicator)
 * - Altura mínima real 64px + safe-area
 * - Ícone + label sempre alinhados, sem quebra de linha
 */
export function MobileBottomNav() {
  const location = useLocation();

  return (
    <nav
      className={cn(
        "lg:hidden fixed bottom-0 left-0 right-0 z-50",
        "bg-background/95 backdrop-blur-xl",
        "border-t border-border/60",
        "shadow-[0_-4px_24px_rgba(0,0,0,0.08)]"
      )}
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
        paddingTop: "8px",
        paddingLeft: "calc(env(safe-area-inset-left, 0px) + 12px)",
        paddingRight: "calc(env(safe-area-inset-right, 0px) + 12px)",
        minHeight: "calc(64px + env(safe-area-inset-bottom, 0px))",
      }}
      aria-label="Navegação principal"
    >
      <ul className="flex items-center justify-around w-full gap-1">
        {items.map((item) => {
          const active = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <li key={item.to} className="flex-1 basis-0 min-w-0 flex">
              <NavLink
                to={item.to}
                end={item.end}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group w-full min-w-0 flex flex-col items-center justify-center gap-1 py-1.5 px-1",
                  "rounded-xl transition-all duration-200 active:scale-95",
                  active
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon
                  size={22}
                  strokeWidth={active ? 2.4 : 2}
                  className="shrink-0 transition-transform"
                />
                <span
                  className={cn(
                    "text-[11px] leading-none font-medium truncate max-w-full whitespace-nowrap",
                    active && "font-semibold"
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
