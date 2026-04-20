import { NavLink, useLocation } from "react-router-dom";
import { Brain, LayoutDashboard, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

type Item = {
  label: string;
  icon: typeof Brain;
  to: string;
  end?: boolean;
};

const ITEMS: Item[] = [
  { label: "Visão", icon: LayoutDashboard, to: "/", end: true },
  { label: "Cérebro", icon: Brain, to: "/brain" },
  { label: "Config", icon: Settings, to: "/settings" },
];

export function MobileBottomNav() {
  const location = useLocation();

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-sidebar"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
      aria-label="Navegação principal"
    >
      <ul className="flex items-stretch justify-around px-2 pt-2">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);

          return (
            <li key={item.label} className="flex-1 flex justify-center">
              <NavLink
                to={item.to}
                end={item.end}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-1.5 rounded-md transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div
                  className={cn(
                    "h-9 w-9 rounded-md flex items-center justify-center transition-colors",
                    active ? "bg-sidebar-accent" : "bg-transparent"
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <span className="text-[10px] font-medium leading-none tracking-wide">
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
