import { NavLink, useLocation } from "react-router-dom";
import { LineChart, BarChart3, Globe2, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/analytics", label: "Deals", icon: LineChart, end: true, match: ["/analytics", "/heatmap"] },
  { to: "/performance", label: "Playlists", icon: BarChart3, match: ["/performance", "/matriz"] },
  { to: "/benchmarks", label: "Mercado", icon: Globe2 },
  { to: "/valuation", label: "Avaliar", icon: Gauge },
];

/**
 * Sub-navegação interna do módulo Analytics (4 abas).
 *
 * Agrupa por PERGUNTA do usuário (não por nome técnico):
 *  - Campanhas: KPIs prometido/entregue + heatmap (era "Visão geral" + "Heatmap")
 *  - Playlists: performance + matriz como sub-aba interna (era "Performance" + "Matriz")
 *  - Mercado: benchmarks por gênero
 *  - Avaliar: calculadora 1-a-1
 *
 * Rotas /matriz e /heatmap continuam ativas como redirects pra preservar deep-links.
 */
export function AnalyticsTabs() {
  const { pathname } = useLocation();
  const isActive = (t: typeof TABS[number]) => {
    const matches = t.match ?? [t.to];
    return t.end
      ? matches.includes(pathname)
      : matches.some((m) => pathname === m || pathname.startsWith(m + "/"));
  };
  return (
    <>
      {/* Desktop: underline rail */}
      <div className="hidden sm:block min-w-0 overflow-hidden border-b border-border -mt-2 mb-6">
        <nav className="nx-tab-rail min-w-0 items-center gap-1 -mb-px px-0">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = isActive(t);
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={cn(
                  "px-2.5 sm:px-3 h-9 inline-flex items-center gap-2 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Mobile: 4 cards na mesma régua */}
      <div className="grid grid-cols-4 gap-1.5 sm:hidden mb-4 -mt-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = isActive(t);
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              aria-pressed={active}
              className={cn(
                "rounded-xl border px-1 py-2 flex flex-col items-center justify-center gap-1 min-w-0 transition-colors",
                active
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-[10px] font-medium leading-tight truncate w-full text-center">{t.label}</span>
            </NavLink>
          );
        })}
      </div>
    </>
  );
}

