import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, Users, Handshake, ArrowRight, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type CuratorRow = { name: string; valor: number; target: number; entregue: number };

type Data = {
  dealsActive: number;
  dealsValor: number;
  dealsTarget: number;
  dealsEntregue: number;
  topCurator: CuratorRow | null;
  topShare: number;
  underdeliverDeals: number;
};

/**
 * Bloco Curadoria do Cockpit:
 *  - Deals ativos (mini-KPI)
 *  - Entrega global (contratado/entregue/progresso)
 *  - Concentração de receita (maior curador)
 */
export function CuradoriaBlock() {
  const [d, setD] = useState<Data | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("curator_deals")
        .select("cost, target_plays, reconciled_total_plays, curator_id, curators(name)")
        .is("closed_at", null);

      const rows = (data ?? []) as any[];
      const dealsValor = rows.reduce((a, r) => a + (Number(r.cost) || 0), 0);
      const dealsTarget = rows.reduce((a, r) => a + (Number(r.target_plays) || 0), 0);
      const dealsEntregue = rows.reduce((a, r) => a + (Number(r.reconciled_total_plays) || 0), 0);

      const byCurator = new Map<string, CuratorRow>();
      for (const r of rows) {
        const name = r.curators?.name ?? "Sem curador";
        const prev = byCurator.get(name) ?? { name, valor: 0, target: 0, entregue: 0 };
        prev.valor += Number(r.cost) || 0;
        prev.target += Number(r.target_plays) || 0;
        prev.entregue += Number(r.reconciled_total_plays) || 0;
        byCurator.set(name, prev);
      }
      const ranked = [...byCurator.values()].sort((a, b) => b.valor - a.valor);
      const topCurator = ranked[0] ?? null;
      const topShare = topCurator && dealsValor > 0 ? (topCurator.valor / dealsValor) * 100 : 0;
      const underdeliverDeals = rows.filter((r) => {
        const tgt = Number(r.target_plays) || 0;
        const del = Number(r.reconciled_total_plays) || 0;
        return tgt > 0 && del / tgt < 0.01;
      }).length;

      if (cancelled) return;
      setD({
        dealsActive: rows.length,
        dealsValor,
        dealsTarget,
        dealsEntregue,
        topCurator,
        topShare,
        underdeliverDeals,
      });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const loading = d === null;

  return (
    <section className="space-y-3">
      <h2 className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold px-1">
        Curadoria
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 lg:gap-4">
        <DealsActiveCard valor={d?.dealsValor ?? 0} count={d?.dealsActive ?? 0} loading={loading} />
        <DeliveryCard d={d} loading={loading} />
        <ConcentrationCard d={d} loading={loading} />
      </div>
    </section>
  );
}

function DealsActiveCard({ valor, count, loading }: { valor: number; count: number; loading: boolean }) {
  return (
    <Link to="/deals" className="nx-card-hover p-4 lg:p-5 flex flex-col gap-3 group h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Handshake className="h-4 w-4 text-primary" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Deals ativos
          </span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-60 lg:opacity-0 transition-opacity group-hover:opacity-100 lg:group-hover:opacity-100" />
      </div>
      {loading ? (
        <div className="h-12 rounded-md bg-muted/40 animate-pulse" />
      ) : (
        <>
          <div className="text-3xl font-semibold tabular-nums tracking-tight text-foreground leading-none">
            R$ {formatNumber(valor)}
          </div>
          <div className="text-xs text-muted-foreground">
            {count} {count === 1 ? "negociação aberta" : "negociações abertas"}
          </div>
        </>
      )}
    </Link>
  );
}

function DeliveryCard({ d, loading }: { d: Data | null; loading: boolean }) {
  const pct = d && d.dealsTarget > 0 ? (d.dealsEntregue / d.dealsTarget) * 100 : 0;
  return (
    <Link to="/deals" className="nx-card-hover p-4 lg:p-5 flex flex-col gap-3 group h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Entrega global
          </span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-60 lg:opacity-0 transition-opacity group-hover:opacity-100 lg:group-hover:opacity-100" />
      </div>
      {loading ? (
        <div className="h-20 rounded-md bg-muted/40 animate-pulse" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div>
              <div className="text-base font-semibold tabular-nums leading-none">{formatNumber(d?.dealsTarget)}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5">Meta</div>
            </div>
            <div>
              <div className="text-base font-semibold tabular-nums leading-none text-primary">{formatNumber(d?.dealsEntregue)}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5">Entregue</div>
            </div>
            <div>
              <div className={cn("text-base font-semibold tabular-nums leading-none", pct < 5 ? "text-destructive" : pct < 30 ? "text-warning" : "text-primary")}>
                {pct.toFixed(1)}%
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5">Progresso</div>
            </div>
          </div>
          <div className="h-1.5 w-full bg-muted/40 rounded-full overflow-hidden mt-1">
            <div
              className={cn("h-full transition-all", pct < 5 ? "bg-destructive" : pct < 30 ? "bg-warning" : "bg-primary")}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          {(d?.underdeliverDeals ?? 0) > 0 && (
            <div className="text-[11px] text-warning flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              <span>{d?.underdeliverDeals} deals com entrega abaixo de 1%</span>
            </div>
          )}
        </>
      )}
    </Link>
  );
}

function ConcentrationCard({ d, loading }: { d: Data | null; loading: boolean }) {
  const top = d?.topCurator;
  const share = d?.topShare ?? 0;
  const risk = share > 50;
  return (
    <Link to="/curadores" className="nx-card-hover p-4 lg:p-5 flex flex-col gap-3 group h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Concentração
          </span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-60 lg:opacity-0 transition-opacity group-hover:opacity-100 lg:group-hover:opacity-100" />
      </div>
      {loading ? (
        <div className="h-20 rounded-md bg-muted/40 animate-pulse" />
      ) : !top ? (
        <div className="text-xs text-muted-foreground py-4">Sem negociações abertas.</div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className={cn("text-3xl font-semibold tabular-nums tracking-tight leading-none", risk ? "text-destructive" : "text-foreground")}>
              {share.toFixed(0)}%
            </span>
            <span className="text-xs text-muted-foreground">do total</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            <span className="font-semibold text-foreground">{top.name}</span> · R$ {formatNumber(top.valor)}
          </div>
          {risk && (
            <div className="text-[11px] text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              <span>Risco — diversifique a base</span>
            </div>
          )}
        </>
      )}
    </Link>
  );
}
