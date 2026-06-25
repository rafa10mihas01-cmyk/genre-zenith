// Métrica de consumo diário da distribuição de catálogo.
// Mostra teto global, executadas hoje, restantes e quebra por owner.
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Stats = {
  limit: number;
  executed_today: number;
  remaining: number;
  by_owner: Array<{ owner: string; count: number }>;
};

async function fetchStats(): Promise<Stats> {
  const { data, error } = await supabase.rpc("catalog_daily_distribution_stats");
  if (error) throw error;
  return data as unknown as Stats;
}

export function DailyDistributionMeter() {
  const { data, isLoading } = useQuery({
    queryKey: ["catalog-daily-distribution-stats"],
    queryFn: fetchStats,
    refetchInterval: 30_000,
  });

  const limit = data?.limit ?? 0;
  const done = data?.executed_today ?? 0;
  const remaining = data?.remaining ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((done / limit) * 100)) : 0;
  const owners = data?.by_owner ?? [];
  const maxOwner = owners[0]?.count ?? 0;

  const barColor =
    pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-primary";

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <header className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Consumo diário</h3>
        </div>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          horário de Brasília
        </span>
      </header>

      <div className="grid grid-cols-3 divide-x divide-border">
        <div className="px-4 py-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Limite diário</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {isLoading ? "—" : limit}
          </div>
        </div>
        <div className="px-4 py-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Executadas hoje</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {isLoading ? "—" : done}
          </div>
        </div>
        <div className="px-4 py-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Restantes hoje</div>
          <div className={cn("mt-1 text-xl font-semibold tabular-nums", remaining === 0 && limit > 0 && "text-red-400")}>
            {isLoading ? "—" : remaining}
          </div>
        </div>
      </div>

      <div className="px-5 pb-2">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full transition-all", barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
          {pct}% do teto consumido
        </div>
      </div>

      {owners.length > 0 && (
        <div className="px-5 pb-5 pt-2 border-t border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Por owner (monitoramento)
          </div>
          <ul className="space-y-1.5">
            {owners.map((o) => {
              const w = maxOwner > 0 ? Math.max(4, Math.round((o.count / maxOwner) * 100)) : 0;
              return (
                <li key={o.owner} className="flex items-center gap-3 text-xs">
                  <span className="w-40 truncate text-foreground-body" title={o.owner}>
                    {o.owner}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-muted-foreground/50" style={{ width: `${w}%` }} />
                  </div>
                  <span className="w-10 text-right tabular-nums text-muted-foreground">
                    {o.count}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!isLoading && owners.length === 0 && (
        <div className="px-5 pb-5 pt-2 border-t border-border text-xs text-muted-foreground">
          Nenhuma distribuição executada hoje ainda.
        </div>
      )}
    </section>
  );
}
