import { NavLink, useLocation } from "react-router-dom";
import { Brain, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type Item = {
  label: string;
  icon: typeof Brain;
  to?: string;
  end?: boolean;
  accent: string;
  onClick?: () => void;
};

/**
 * MobileBottomNav — barra fixa inferior visível apenas no mobile (md:hidden)
 * Glass escuro, safe-area-inset, ações principais (Cérebro + Sair)
 */
export function MobileBottomNav() {
  const { signOut } = useAuth();
  const location = useLocation();

  const items: Item[] = [
    { label: "Cérebro", icon: Brain, to: "/", end: true, accent: "99,102,241" },
    { label: "Sair", icon: LogOut, accent: "244,63,94", onClick: () => signOut() },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border/40"
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)",
        background:
          "linear-gradient(180deg, rgba(10,12,22,0.85) 0%, rgba(7,11,20,0.95) 100%)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "0 -4px 24px rgba(0,0,0,0.35)",
      }}
      aria-label="Navegação principal"
    >
      <ul className="flex items-stretch justify-around px-2 pt-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.to
            ? item.end
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to)
            : false;

          const content = (
            <div className="flex flex-col items-center gap-1 px-3 py-1.5">
              <div
                className="h-9 w-9 rounded-xl flex items-center justify-center transition-all"
                style={{
                  background: active
                    ? `linear-gradient(135deg, rgba(${item.accent},0.30) 0%, rgba(${item.accent},0.18) 100%)`
                    : `rgba(${item.accent},0.10)`,
                  border: `1px solid rgba(${item.accent},${active ? 0.45 : 0.20})`,
                  boxShadow: active
                    ? `0 0 16px rgba(${item.accent},0.35)`
                    : "none",
                }}
              >
                <Icon
                  className="h-[18px] w-[18px]"
                  style={{ color: `rgba(${item.accent},1)` }}
                />
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium leading-none tracking-wide",
                  active ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {item.label}
              </span>
            </div>
          );

          return (
            <li key={item.label} className="flex-1 flex justify-center">
              {item.to ? (
                <NavLink to={item.to} end={item.end} className="block">
                  {content}
                </NavLink>
              ) : (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="block focus:outline-none"
                  aria-label={item.label}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
