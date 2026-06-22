// Financeiro — abas: Visão · Receita · Custo · Margem · Configuração
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Wallet,
  DollarSign,
  Receipt,
  TrendingUp,
  TrendingDown,
  Settings as SettingsIcon,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Kpi, type KpiTone } from "@/components/ui/kpi";
import { KpiCompactStrip } from "@/components/KpiCompactStrip";
import { FinanceiroTab } from "@/components/playlist-deals/FinanceiroTab";
import { FinancialOverview } from "@/components/financeiro/FinancialOverview";
import { PricingSettingsPanel } from "@/components/financeiro/PricingSettingsPanel";

import { useFinancialOverview } from "@/hooks/useFinancialOverview";
import { cn } from "@/lib/utils";

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const toneMap = (t: "primary" | "warn" | "muted"): KpiTone =>
  t === "primary" ? "primary" : t === "warn" ? "warning" : "default";


function ReceitaView() {
  const { summary, totals, loading } = useFinancialOverview();
  const rows = useMemo(
    () => [...summary].sort((a, b) => Number(b.valor_recebido ?? 0) - Number(a.valor_recebido ?? 0)),
    [summary],
  );
  if (loading) return <div className="h-40 rounded-2xl bg-card border border-border animate-pulse" />;
  return (
    <div className="space-y-6">
      <KpiCompactStrip
        rows={[
          {
            items: [
              { label: "Recebido", value: fmtBRL(totals.recebido) },
              { label: "Cobrado", value: fmtBRL(totals.cobrado) },
              { label: "Pendente", value: fmtBRL(Math.max(0, totals.cobrado - totals.recebido)) },
            ],
          },
        ]}
      />
      <section className="hidden lg:grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Kpi icon={DollarSign} label="Recebido" value={fmtBRL(totals.recebido)} tone="primary" />
        <Kpi icon={Receipt} label="Cobrado" value={fmtBRL(totals.cobrado)} />
        <Kpi
          icon={AlertTriangle}
          label="Pendente"
          value={fmtBRL(Math.max(0, totals.cobrado - totals.recebido))}
          tone={toneMap(totals.cobrado - totals.recebido > 0 ? "warn" : "muted")}
        />
      </section>

      <section className="rounded-2xl bg-card border border-border overflow-hidden">
        <header className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Receita por campanha</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Cobrado, recebido e pendente do cliente</p>
        </header>
        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">Nenhuma campanha</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-elevated/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Campanha</th>
                  <th className="hidden sm:table-cell text-left px-4 py-2 font-medium">Artista</th>
                  <th className="text-right px-4 py-2 font-medium">Cobrado</th>
                  <th className="text-right px-4 py-2 font-medium">Recebido</th>
                  <th className="text-right px-4 py-2 font-medium">Pendente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((s) => {
                  const pend = Math.max(0, Number(s.valor_cobrado ?? 0) - Number(s.valor_recebido ?? 0));
                  return (
                    <tr key={s.campaign_id} className="hover:bg-elevated/40">
                      <td className="px-4 py-2.5 font-medium text-foreground truncate max-w-[260px]">{s.track_name ?? "—"}</td>
                      <td className="hidden sm:table-cell px-4 py-2.5 text-muted-foreground">{s.artist ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(s.valor_cobrado)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-primary font-semibold">{fmtBRL(s.valor_recebido)}</td>
                      <td className={cn("px-4 py-2.5 text-right tabular-nums", pend > 0 ? "text-amber-500" : "text-muted-foreground")}>
                        {fmtBRL(pend)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MargemView() {
  const { summary, totals, loading } = useFinancialOverview();
  const rows = useMemo(
    () => [...summary].sort((a, b) => (b.margem_bruta ?? 0) - (a.margem_bruta ?? 0)),
    [summary],
  );
  if (loading) return <div className="h-40 rounded-2xl bg-card border border-border animate-pulse" />;
  return (
    <div className="space-y-6">
      <KpiCompactStrip
        rows={[
          {
            items: [
              { label: "Margem", value: fmtBRL(totals.margem) },
              { label: "Margem %", value: totals.margemPct == null ? "—" : `${totals.margemPct.toFixed(1)}%` },
              { label: "Líquido", value: fmtBRL(totals.recebido - totals.pagoPorCampanha) },
            ],
          },
        ]}
      />
      <section className="hidden lg:grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Kpi
          icon={totals.margem >= 0 ? TrendingUp : TrendingDown}
          label="Margem bruta"
          value={fmtBRL(totals.margem)}
          tone={toneMap(totals.margem >= 0 ? "primary" : "warn")}
        />
        <Kpi
          icon={TrendingUp}
          label="Margem %"
          value={totals.margemPct == null ? "—" : `${totals.margemPct.toFixed(1)}%`}
          tone={toneMap(totals.margemPct != null && totals.margemPct >= 30 ? "primary" : "muted")}
        />
        <Kpi icon={Wallet} label="Resultado líquido" value={fmtBRL(totals.recebido - totals.pagoPorCampanha)} />
      </section>

      <section className="rounded-2xl bg-card border border-border overflow-hidden">
        <header className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Margem por campanha</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Da mais rentável pra menos rentável</p>
        </header>
        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">Nenhuma campanha</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-elevated/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Campanha</th>
                  <th className="text-right px-4 py-2 font-medium">Recebido</th>
                  <th className="text-right px-4 py-2 font-medium">Pago</th>
                  <th className="text-right px-4 py-2 font-medium">Margem R$</th>
                  <th className="hidden sm:table-cell text-right px-4 py-2 font-medium">Margem %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((s) => (
                  <tr key={s.campaign_id} className="hover:bg-elevated/40">
                    <td className="px-4 py-2.5 font-medium text-foreground truncate max-w-[260px]">{s.track_name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtBRL(s.valor_recebido)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmtBRL(s.total_pago_curadores)}</td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", s.margem_bruta >= 0 ? "text-primary" : "text-amber-500")}>
                      {fmtBRL(s.margem_bruta)}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {s.margem_pct == null ? "—" : `${s.margem_pct}%`}
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function Financeiro() {

  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "visao";
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  };

  const TABS = [
    { id: "visao",   label: "Visão",        icon: Wallet },
    { id: "receita", label: "Receita",      icon: DollarSign },
    { id: "custo",   label: "Custo",        icon: Receipt },
    { id: "margem",  label: "Margem",       icon: TrendingUp },
    { id: "config",  label: "Configuração", icon: SettingsIcon },
  ];

  return (
    <>
      <PageHeader
        kicker="Operação"
        icon={Wallet}
        title="Financeiro"
        subtitle="Receita, custo e margem"
        domain="deals"
        manualKey="financeiro"
      />
      <PageContainer>
        {/* Desktop: tabs underline */}
        <div className="hidden sm:flex items-center gap-1 border-b border-border mb-6 overflow-x-auto scrollbar-none">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "px-3 lg:px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Mobile: 5 cards na mesma régua */}
        <div className="grid grid-cols-5 gap-1.5 sm:hidden mb-4">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            const shortLabel =
              t.id === "visao" ? "Visão" :
              t.id === "receita" ? "Receita" :
              t.id === "custo" ? "Custo" :
              t.id === "margem" ? "Margem" : "Config";
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={active}
                className={cn(
                  "rounded-xl border px-0.5 py-2 flex flex-col items-center justify-center gap-1 min-w-0 transition-colors",
                  active
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="text-[10px] font-medium leading-tight truncate w-full text-center">{shortLabel}</span>
              </button>
            );
          })}
        </div>

        <div className="animate-tab-in">
          {tab === "visao"   && <FinancialOverview />}
          {tab === "receita" && <ReceitaView />}
          {tab === "custo"   && <FinanceiroTab />}
          {tab === "margem"  && <MargemView />}
          {tab === "config"  && <PricingSettingsPanel />}
        </div>
      </PageContainer>
    </>
  );
}

