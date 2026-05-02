import { useMemo } from "react";
import { Users, DollarSign, Target as TargetIcon, TrendingUp } from "lucide-react";
import { KpiBig } from "@/components/KpiBig";
import { computeCuratorStats, type CuratorDeal, type CuratorDealLog, type CuratorPlaylist } from "@/lib/curatorDealsUtils";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  deals: CuratorDeal[];
  logs: CuratorDealLog[];
  playlists: CuratorPlaylist[];
  loading: boolean;
};

type CuratorRow = {
  name: string;
  dealsCount: number;
  totalCost: number;
  totalEarned: number;
  totalTarget: number;
  costPerPlay: number | null;   // R$/play
  deliveryPct: number;           // earned/target
};

const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(v);

const formatCostPerPlay = (v: number | null) => {
  if (v === null || !isFinite(v)) return "—";
  // Mostra com 4 casas se < 0.01, senão 2 casas
  const opts = v < 0.01
    ? { minimumFractionDigits: 4, maximumFractionDigits: 4 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", ...opts }).format(v);
};

export function CuradoresTab({ deals, logs, playlists, loading }: Props) {
  const { rows, totals } = useMemo(() => {
    const map = new Map<string, CuratorRow>();
    let totalCost = 0;
    let totalEarned = 0;
    let totalTarget = 0;

    for (const d of deals) {
      const name = (d.curator_name ?? "").trim() || "—";
      const cost = Number(d.cost ?? 0) || 0;
      const target = Number(d.target_plays ?? 0) || 0;
      const { earned } = computeCuratorStats(d, logs, playlists);

      const row = map.get(name) ?? {
        name,
        dealsCount: 0,
        totalCost: 0,
        totalEarned: 0,
        totalTarget: 0,
        costPerPlay: null,
        deliveryPct: 0,
      };
      row.dealsCount += 1;
      row.totalCost += cost;
      row.totalEarned += earned;
      row.totalTarget += target;
      map.set(name, row);

      totalCost += cost;
      totalEarned += earned;
      totalTarget += target;
    }

    const rows = Array.from(map.values()).map((r) => {
      // Usa plays entregues quando já houver entrega; senão, cai pra meta contratada
      const denom = r.totalEarned > 0 ? r.totalEarned : r.totalTarget;
      return {
        ...r,
        costPerPlay: denom > 0 ? r.totalCost / denom : null,
        deliveryPct: r.totalTarget > 0 ? Math.round((r.totalEarned / r.totalTarget) * 100) : 0,
      };
    });

    // Ordena: melhor custo/play primeiro (quem entrega mais barato)
    rows.sort((a, b) => {
      if (a.costPerPlay === null && b.costPerPlay === null) return b.totalCost - a.totalCost;
      if (a.costPerPlay === null) return 1;
      if (b.costPerPlay === null) return -1;
      return a.costPerPlay - b.costPerPlay;
    });

    return {
      rows,
      totals: {
        curators: map.size,
        totalCost,
        totalEarned,
        totalTarget,
        avgCostPerPlay:
          totalEarned > 0
            ? totalCost / totalEarned
            : totalTarget > 0
            ? totalCost / totalTarget
            : null,
        deliveryPct: totalTarget > 0 ? Math.round((totalEarned / totalTarget) * 100) : 0,
      },
    };
  }, [deals, logs, playlists]);

  const isEmpty = !loading && deals.length === 0;

  return (
    <div className="space-y-6">
      {/* KPIs gerais */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig
          icon={Users}
          label="Curadores"
          value={formatNumber(totals.curators)}
          hint="Distintos com deals"
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={DollarSign}
          label="Total investido"
          value={formatBRL(totals.totalCost)}
          hint={`${deals.length} ${deals.length === 1 ? "deal" : "deals"}`}
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={TargetIcon}
          label="Plays entregues"
          value={formatNumber(totals.totalEarned)}
          hint={totals.totalTarget > 0 ? `${totals.deliveryPct}% das metas` : "Sem metas"}
          tone={totals.deliveryPct >= 80 ? "success" : totals.deliveryPct >= 40 ? "primary" : "default"}
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={TrendingUp}
          label="Custo médio / play"
          value={formatCostPerPlay(totals.avgCostPerPlay)}
          hint={totals.totalEarned > 0 ? "Real (gasto ÷ plays entregues)" : "Estimado (gasto ÷ meta)"}
          tone="primary"
          loading={loading && deals.length === 0}
        />
      </section>

      {/* Tabela por curador */}
      {isEmpty ? (
        <div className="nx-card">
          <div className="py-10 flex flex-col items-center text-center gap-3">
            <div className="h-12 w-12 rounded-full bg-elevated border border-border flex items-center justify-center">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <div className="font-semibold">Sem curadores ainda</div>
              <div className="text-sm text-muted-foreground mt-1">
                Cadastre um deal para começar a comparar custos
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="nx-card !p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight">Comparativo por curador</h3>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Ordenado pelo melhor custo por play
              </p>
            </div>
            <span className="text-[12px] text-muted-foreground">
              {rows.length} {rows.length === 1 ? "curador" : "curadores"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left px-5 py-3 font-medium">Curador</th>
                  <th className="text-right px-3 py-3 font-medium">Deals</th>
                  <th className="text-right px-3 py-3 font-medium">Investido</th>
                  <th className="text-right px-3 py-3 font-medium">Plays</th>
                  <th className="text-right px-3 py-3 font-medium">R$/play</th>
                  <th className="text-right px-5 py-3 font-medium">Entrega</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isBest = i === 0 && r.costPerPlay !== null && rows.length > 1;
                  return (
                    <tr
                      key={r.name}
                      className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{r.name}</span>
                          {isBest && (
                            <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                              Melhor
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-muted-foreground">
                        {r.dealsCount}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums">
                        {formatBRL(r.totalCost)}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums">
                        {formatNumber(r.totalEarned)}
                        {r.totalTarget > 0 && (
                          <span className="text-muted-foreground"> / {formatNumber(r.totalTarget)}</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums font-semibold text-primary">
                        {formatCostPerPlay(r.costPerPlay)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span
                          className={cn(
                            "inline-flex items-center text-[12px] font-medium tabular-nums px-2 py-0.5 rounded",
                            r.deliveryPct >= 100
                              ? "bg-success/15 text-success"
                              : r.deliveryPct >= 80
                              ? "bg-primary/15 text-primary"
                              : r.deliveryPct >= 40
                              ? "bg-warning/15 text-warning"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {r.totalTarget > 0 ? `${r.deliveryPct}%` : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
