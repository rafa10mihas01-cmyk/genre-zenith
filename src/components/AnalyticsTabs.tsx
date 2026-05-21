import { NavLink, useLocation } from "react-router-dom";
import { LineChart, BarChart3, Globe2, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/analytics", label: "Campanhas", icon: LineChart, end: true, match: ["/analytics", "/heatmap"] },
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
  return (
    <div className="border-b border-border -mt-2 mb-6">
      <nav className="flex items-center gap-1 overflow-x-auto -mb-px">
        {TABS.map((t) => {
          const Icon = t.icon;
          const matches = t.match ?? [t.to];
          const active = t.end
            ? matches.includes(pathname)
            : matches.some((m) => pathname === m || pathname.startsWith(m + "/"));
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={cn(
                "px-3 h-9 inline-flex items-center gap-2 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap",
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
  );
}
