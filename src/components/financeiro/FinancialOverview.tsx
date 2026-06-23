// FinancialOverview — visão Cliente↔Curador: receita, custo, margem e pagamentos.
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, Plus, TrendingUp, TrendingDown, DollarSign, Wallet } from "lucide-react";
import { useFinancialOverview, type DealFinanceRow } from "@/hooks/useFinancialOverview";
import { DealPaymentDialog } from "./DealPaymentDialog";

import { Button } from "@/components/ui/button";
import { Kpi } from "@/components/ui/kpi";
import { KpiCompactStrip } from "@/components/KpiCompactStrip";
import { FinanceiroMobileTabs } from "./FinanceiroMobileTabs";

import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function StatusBadge({ pct }: { pct: number }) {
  const tone = pct >= 80 ? "text-primary bg-primary/10" : pct >= 30 ? "text-amber-500 bg-amber-500/10" : "text-rose-400 bg-rose-500/10";
  return <span className={cn("px-2 py-0.5 rounded-full text-xs tabular-nums", tone)}>{pct.toFixed(0)}%</span>;
}

export function FinancialOverview() {
  const { summary, dealsFinance, totals, loading, registerPayment } = useFinancialOverview();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialogDeal, setDialogDeal] = useState<DealFinanceRow | null>(null);

  const dealsByCampaign = useMemo(() => {
    const map = new Map<string, DealFinanceRow[]>();
    for (const d of dealsFinance) {
      const key = d.campaign_id ?? "__no_campaign__";
      const arr = map.get(key) ?? [];
      arr.push(d);
      map.set(key, arr);
    }
    return map;
  }, [dealsFinance]);

  const alerts = useMemo(() => {
    const list: { id: string; type: "delivery_late" | "payment_pending"; label: string }[] = [];
    for (const d of dealsFinance) {
      if (!d.closed_at && d.delivery_pct < 10 && d.days_open > 7) {
        list.push({ id: `${d.deal_id}_delivery`, type: "delivery_late", label: `${d.song_name} · ${d.curator_name}: entrega < 10% após ${d.days_open}d` });
      }
    }
    for (const s of summary) {
      if (Number(s.valor_recebido ?? 0) > 0 && Number(s.total_pago_curadores ?? 0) === 0) {
        list.push({ id: `${s.campaign_id}_pay`, type: "payment_pending", label: `${s.track_name ?? "Campanha"}: cliente pagou, curador pendente` });
      }
    }
    return list;
  }, [dealsFinance, summary]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (loading) {
    return <div className="h-40 rounded-2xl bg-card border border-border animate-pulse" />;
  }

  return (
    <div className="space-y-6">


      {/* ===== KPIs mobile/tablet: strip compacta ===== */}
      <KpiCompactStrip
        rows={[
          {
            items: [
              { label: "Recebido", value: fmtBRL(totals.recebido) },
              { label: "Investido", value: fmtBRL(totals.custoCaixa) },
              { label: "Margem", value: fmtBRL(totals.margem) },
              { label: "Margem %", value: totals.margemPct == null ? "—" : `${totals.margemPct.toFixed(1)}%` },
            ],
          },
        ]}
      />

      <FinanceiroMobileTabs />

      {/* ===== KPIs desktop ===== */}
      <section className="hidden lg:grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={DollarSign} label="Recebido de clientes" value={fmtBRL(totals.recebido)} tone="primary" />
        <Kpi
          icon={Wallet}
          label="Investido em curadoria"
          value={fmtBRL(totals.custoCaixa)}
          hint={
            totals.custoNaoAlocado > 0
              ? `${fmtBRL(totals.custoNaoAlocado)} sem deal vinculado`
              : undefined
          }
        />
        <Kpi
          icon={totals.margem >= 0 ? TrendingUp : TrendingDown}
          label="Margem bruta"
          value={fmtBRL(totals.margem)}
          tone={totals.margem >= 0 ? "primary" : "warning"}
          hint={totals.custoNaoAlocado > 0 ? "Exclui custo não alocado" : undefined}
        />
        <Kpi
          icon={TrendingUp}
          label="Margem %"
          value={totals.margemPct == null ? "—" : `${totals.margemPct.toFixed(1)}%`}
          tone={totals.margemPct != null && totals.margemPct >= 30 ? "primary" : "default"}
        />
      </section>



      {/* ===== Aviso de custo não alocado ===== */}
      {totals.custoNaoAlocado > 0 && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold text-amber-300">
              {fmtBRL(totals.custoNaoAlocado)} em compras sem deal vinculado
            </div>
            <p className="text-xs text-amber-200/80 mt-0.5">
              {totals.numComprasNaoAlocadas} compra{totals.numComprasNaoAlocadas === 1 ? "" : "s"} de curadoria entram no caixa total mas não somam em nenhuma campanha.
              Para aparecer na margem por campanha, vincule a compra a um deal ao registrar.
            </p>
          </div>
        </section>
      )}

      {/* ===== Alertas ===== */}
      {alerts.length > 0 && (
        <section className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-rose-300 mb-2">
            <AlertTriangle className="h-4 w-4" /> Alertas financeiros
          </div>
          <ul className="space-y-1 text-sm text-rose-200/90">
            {alerts.map((a) => <li key={a.id}>• {a.label}</li>)}
          </ul>
        </section>
      )}

      {/* ===== Tabela por campanha ===== */}
      <section className="rounded-2xl bg-card border border-border overflow-hidden">
        <header className="px-4 sm:px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Receita vs Custo por campanha</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Clique para expandir os deals da campanha</p>
        </header>

        {summary.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">Nenhuma campanha registrada</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-elevated/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Campanha</th>
                  <th className="hidden sm:table-cell text-left px-4 py-2 font-medium">Artista</th>
                  <th className="text-right px-4 py-2 font-medium">Recebido</th>
                  <th className="hidden sm:table-cell text-right px-4 py-2 font-medium">Pago</th>
                  <th className="text-right px-4 py-2 font-medium">Margem</th>
                  <th className="hidden sm:table-cell text-right px-4 py-2 font-medium">Entrega</th>

                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.map((s) => {
                  const deals = dealsByCampaign.get(s.campaign_id) ?? [];
                  const avgDelivery = deals.length > 0
                    ? deals.reduce((a, d) => a + d.delivery_pct, 0) / deals.length
                    : 0;
                  const isOpen = expanded.has(s.campaign_id);
                  return (
                    <Fragment key={s.campaign_id}>
                      <tr
                        className="hover:bg-elevated/40 cursor-pointer"
                        onClick={() => toggle(s.campaign_id)}
                      >
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          <div className="flex items-center gap-1.5">
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                            <span className="truncate max-w-[220px]">{s.track_name ?? "—"}</span>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell px-4 py-2.5 text-muted-foreground">{s.artist ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(s.valor_recebido)}</td>
                        <td className="hidden sm:table-cell px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmtBRL(s.total_pago_curadores)}</td>
                        <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", s.margem_bruta >= 0 ? "text-primary" : "text-amber-500")}>
                          {fmtBRL(s.margem_bruta)}
                          {s.margem_pct != null && <span className="ml-1 text-xs text-muted-foreground">({s.margem_pct}%)</span>}
                        </td>
                        <td className="hidden sm:table-cell px-4 py-2.5 text-right">
                          {deals.length > 0 ? <StatusBadge pct={avgDelivery} /> : <span className="text-xs text-muted-foreground">—</span>}
                        </td>

                        <td />
                      </tr>
                      {isOpen && deals.length > 0 && (
                        <tr>
                          <td colSpan={7} className="p-0 bg-elevated/20">
                            <div className="px-6 py-3 space-y-2">
                              {deals.map((d) => {
                                const remaining = Math.max(0, d.cost - d.total_paid);
                                return (
                                  <div key={d.deal_id} className="flex items-center gap-3 text-xs py-2 border-b border-border last:border-0">
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-foreground truncate">{d.curator_name}</div>
                                      <div className="text-muted-foreground tabular-nums">
                                        {formatNumber(d.reconciled_total_plays)} / {formatNumber(d.target_plays)} plays · <StatusBadge pct={d.delivery_pct} />
                                      </div>
                                    </div>
                                    <div className="text-right tabular-nums shrink-0 w-28">
                                      <div>{fmtBRL(d.cost)}</div>
                                      <div className="text-muted-foreground text-[11px]">custo</div>
                                    </div>
                                    <div className="text-right tabular-nums shrink-0 w-28">
                                      <div className={cn(d.total_paid > 0 ? "text-primary" : "text-muted-foreground")}>{fmtBRL(d.total_paid)}</div>
                                      <div className="text-muted-foreground text-[11px]">pago</div>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="soft"
                                      onClick={(e) => { e.stopPropagation(); setDialogDeal(d); }}
                                    >
                                      <Plus className="h-3 w-3" /> Compra
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialogDeal && (
        <DealPaymentDialog
          open={!!dialogDeal}
          onOpenChange={(v) => !v && setDialogDeal(null)}
          dealId={dialogDeal.deal_id}
          curatorId={dialogDeal.curator_id}
          dealLabel={`${dialogDeal.song_name} — ${dialogDeal.curator_name}`}
          remainingHint={Math.max(0, dialogDeal.cost - dialogDeal.total_paid)}
          remainingPlaysHint={Math.max(0, dialogDeal.target_plays - dialogDeal.reconciled_total_plays)}
          onSubmit={registerPayment}
        />
      )}
    </div>
  );
}

