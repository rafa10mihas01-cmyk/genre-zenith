import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/analytics", label: "Visão geral", end: true },
  { to: "/performance", label: "Performance" },
  { to: "/valuation", label: "Valuation" },
  { to: "/benchmarks", label: "Benchmarks" },
  { to: "/matriz", label: "Matriz" },
  { to: "/heatmap", label: "Heatmap" },
];

/**
 * Sub-navegação interna do módulo Analytics.
 * Renderizada logo abaixo do PageHeader em cada uma das 6 telas analíticas
 * (Analytics, Performance, Valuation, Benchmarks, Matriz, Heatmap).
 *
 * Mantém URLs canônicas mas dá a sensação de "uma página com tabs internas",
 * eliminando a necessidade de submenus longos na sidebar.
 */
export function AnalyticsTabs() {
  const { pathname } = useLocation();
  return (
    <div className="border-b border-border -mt-2 mb-6">
      <nav className="flex items-center gap-1 overflow-x-auto -mb-px">
        {TABS.map((t) => {
          const active = t.end ? pathname === t.to : pathname.startsWith(t.to);
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={cn(
                "px-3 h-9 inline-flex items-center text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
              )}
            >
              {t.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
