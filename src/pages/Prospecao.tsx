import { useMemo, useState } from "react";
import { useScreenField } from "@/lib/screen-state";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { RefreshCw, Handshake, UserSearch, Users, Activity, DollarSign, TrendingUp, Send, Mail, CheckCircle2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { KpiBig } from "@/components/KpiBig";
import { KpiCompactStrip } from "@/components/KpiCompactStrip";
import { CuradoresCRM } from "@/components/operacao/CuradoresCRM";
import { CuradoresLibraryTab } from "@/components/playlist-deals/CuradoresLibraryTab";
import { OutreachDashboard } from "@/components/operacao/OutreachDashboard";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Segment = "ativos" | "prospeccao";

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

function formatNumber(n: number) {
  return n.toLocaleString("pt-BR");
}

function FunilStep({
  label, value, hint, loading, muted,
}: { label: string; value: string; hint?: string; loading?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center text-center gap-1 min-w-0 px-1", muted && "opacity-60")}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate w-full">{label}</div>
      <div className={cn("text-xl font-semibold tabular-nums truncate w-full leading-none", muted && "text-muted-foreground")}>
        {loading ? "…" : value}
      </div>
      <div className="text-[10px] text-primary font-medium tabular-nums h-3 leading-none">{hint ?? "\u00A0"}</div>
    </div>
  );
}

export default function Prospecao() {
  const [segment, setSegment] = useScreenField<Segment>("/curadores", "segment", "ativos");
  const [addCuratorOpen, setAddCuratorOpen] = useState(false);
  const {
    curators, balances, deals, loading,
    addCurator, updateCurator, addCuratorPurchase, archiveCurator, deleteCurator, pauseCurator,
    reload,
  } = useCuratorDeals();

  const ativosCount = curators.filter((c) => !c.archived_at).length;

  const kpisAtivos = useMemo(() => {
    const activeCurators = curators.filter((c) => !c.archived_at);
    const dealsAtivos = deals.filter((d) => !d.closed_at).length;
    // "custoTotal" = soma de v_curator_balance.total_cost (pago a curadores).
    // NÃO é receita do cliente — esta vive em useFinancialOverview.totals.recebido.
    const custoTotal = balances.reduce((acc, b) => acc + (Number(b.total_cost) || 0), 0);
    const totalDeals = deals.length;
    const ticket = totalDeals > 0 ? custoTotal / totalDeals : 0;
    return { curadores: activeCurators.length, dealsAtivos, custoTotal, ticket };
  }, [curators, balances, deals]);


  // Outreach KPIs (cache compartilhado entre montagens da página)
  const outreachQuery = useQuery({
    queryKey: ["outreach"],
    enabled: segment === "prospeccao",
    staleTime: 60_000,
    gcTime: 600_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [extRes, logsRes] = await Promise.all([
        supabase.from("external_curators").select("id, pipeline_status"),
        supabase.from("curator_outreach_log").select("external_curator_id, event_type"),
      ]);
      const ext = (extRes.data ?? []) as { id: string; pipeline_status: string }[];
      const logs = (logsRes.data ?? []) as { external_curator_id: string | null; event_type: string }[];
      const leads = ext.length;
      const contatadosSet = new Set(
        logs
          .filter((l) => l.external_curator_id && (l.event_type === "sent" || l.event_type.startsWith("followup")))
          .map((l) => l.external_curator_id as string),
      );
      const respondidosSet = new Set(
        logs.filter((l) => l.external_curator_id && l.event_type === "replied").map((l) => l.external_curator_id as string),
      );
      const convertidos = ext.filter((c) => c.pipeline_status === "fechado").length;
      return {
        leads,
        contatados: contatadosSet.size,
        respondidos: respondidosSet.size,
        convertidos,
      };
    },
  });

  const outreach = {
    leads: outreachQuery.data?.leads ?? 0,
    contatados: outreachQuery.data?.contatados ?? 0,
    respondidos: outreachQuery.data?.respondidos ?? 0,
    convertidos: outreachQuery.data?.convertidos ?? 0,
    loading: outreachQuery.isLoading && !outreachQuery.data,
  };

  const taxaResposta = outreach.contatados > 0 ? (outreach.respondidos / outreach.contatados) * 100 : 0;

  return (
    <>
      <PageHeader
        title="Curadores"
        subtitle="Ativos e prospecção"
        domain="curators"
        manualKey="curadores"
        actions={
          <div className="flex items-center gap-1.5">
            {segment === "ativos" && (
              <Button
                size="sm"
                className="h-9 rounded-full gap-1.5 px-3 sm:px-4"
                onClick={() => setAddCuratorOpen(true)}
                aria-label="Novo curador"
                title="Novo curador"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Novo curador</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              className="rounded-full h-9 w-9"
              onClick={() => (segment === "ativos" ? reload() : window.location.reload())}
              aria-label="Recarregar"
              title="Recarregar"
            >
              <RefreshCw className={cn("h-4 w-4", loading && segment === "ativos" && "animate-spin")} />
            </Button>
          </div>
        }
      />

      <PageContainer>

      {/* Segmento de alto nível */}
      {(() => {
        const SEG = [
          { id: "ativos" as const,      label: "Ativos",     icon: Handshake,  count: ativosCount,    hint: "Curadores com quem você já fechou deal" },
          { id: "prospeccao" as const,  label: "Prospecção", icon: UserSearch, count: outreach.leads, hint: "Contatos para abordar e negociar" },
        ];
        return (
          <>
            {/* Desktop: rail clássico (mantido no topo) */}
            <div className="hidden sm:block sticky top-0 z-30 -mt-px bg-background border-b border-border -mx-4 md:-mx-6">
              <div className="nx-tab-rail items-center gap-1 px-4 md:px-6">
                {SEG.map((t) => {
                  const Icon = t.icon;
                  const active = segment === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSegment(t.id)}
                      title={t.hint}
                      className={cn(
                        "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 transition-colors -mb-px shrink-0 whitespace-nowrap",
                        active
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t.label}
                      <span className={cn(
                        "ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold tabular-nums",
                        active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                      )}>
                        {t.id === "prospeccao" && outreach.loading ? "…" : t.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        );
      })()}


      {/* Ativos: KPI grid original (mobile + desktop). Prospecção: funil único no mobile. */}
      {segment === "ativos" ? (
        <>
          <KpiCompactStrip
            loading={loading}
            rows={[{
              items: [
                { label: "Curadores", value: formatNumber(kpisAtivos.curadores) },
                { label: "Deals ativos", value: formatNumber(kpisAtivos.dealsAtivos) },
                { label: "Custo total", value: formatBRL(kpisAtivos.custoTotal) },
                { label: "Ticket médio", value: formatBRL(kpisAtivos.ticket) },

              ],
            }]}
          />
          <section className="hidden lg:grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiBig tier="hero" icon={Users} label="Curadores" value={formatNumber(kpisAtivos.curadores)} hint="Ativos na biblioteca" domain="curators" loading={loading} />
            <KpiBig icon={Activity} label="Deals ativos" value={formatNumber(kpisAtivos.dealsAtivos)} hint="Negociações em andamento" domain="campaigns" loading={loading} />
            <KpiBig icon={DollarSign} label="Custo total" value={formatBRL(kpisAtivos.custoTotal)} hint="Pago a curadores" domain="deals" loading={loading} />
            <KpiBig tier="quiet" icon={TrendingUp} label="Ticket médio" value={formatBRL(kpisAtivos.ticket)} hint={`Base ${formatNumber(deals.length)} deals`} domain="deals" loading={loading} />

          </section>
        </>
      ) : (
        <>
          {/* MOBILE — funil único de prospecção */}
          <section className="lg:hidden rounded-2xl border border-border bg-card p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Funil de prospecção</div>
            <div className="grid grid-cols-4 items-stretch divide-x divide-border/60">
              <FunilStep label="Leads" value={formatNumber(outreach.leads)} loading={outreach.loading} />
              <FunilStep label="Contatados" value={formatNumber(outreach.contatados)} loading={outreach.loading} />
              <FunilStep label="Respostas" value={formatNumber(outreach.respondidos)} loading={outreach.loading} hint={`${taxaResposta.toFixed(0)}%`} />
              <FunilStep label="Convertidos" value={formatNumber(outreach.convertidos)} loading={outreach.loading} muted />
            </div>
          </section>
          {/* DESKTOP — KPIs completos */}
          <section className="hidden lg:grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiBig tier="hero" icon={UserSearch} label="Leads" value={formatNumber(outreach.leads)} hint="Curadores na base de prospecção" domain="curators" loading={outreach.loading} />
            <KpiBig icon={Send} label="Contatados" value={formatNumber(outreach.contatados)} hint="Curadores que receberam abordagem" domain="campaigns" loading={outreach.loading} />
            <KpiBig icon={Mail} label="Taxa de resposta" value={`${taxaResposta.toFixed(0)}%`} hint={`${formatNumber(outreach.respondidos)} respostas`} domain="campaigns" loading={outreach.loading} />
            <KpiBig tier="quiet" icon={CheckCircle2} label="Convertidos" value={formatNumber(outreach.convertidos)} hint="Fechados como curador ativo" domain="deals" loading={outreach.loading} />
          </section>
        </>
      )}

      {/* Mobile: seletor de segmento posicionado acima da busca/filtros do conteúdo */}
      {(() => {
        const SEG_M = [
          { id: "ativos" as const,     label: "Ativos",     icon: Handshake,  count: ativosCount },
          { id: "prospeccao" as const, label: "Prospecção", icon: UserSearch, count: outreach.leads },
        ];
        return (
          <div className="grid grid-cols-2 gap-1.5 sm:hidden">
            {SEG_M.map((t) => {
              const Icon = t.icon;
              const active = segment === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSegment(t.id)}
                  className={cn(
                    "rounded-xl border px-2 py-2.5 flex flex-col items-center justify-center gap-1 transition-colors",
                    active
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={active}
                >
                  <Icon className={cn("h-4 w-4", active ? "text-primary" : "")} />
                  <span className="text-[12px] font-medium leading-none">{t.label}</span>
                  <span className={cn("text-[11px] font-bold tabular-nums leading-none", active ? "text-primary" : "text-muted-foreground")}>
                    {t.id === "prospeccao" && outreach.loading ? "…" : t.count}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })()}

      <section className="space-y-4 animate-tab-in" key={segment}>

        {segment === "ativos" ? (
          <CuradoresLibraryTab
            curators={curators}
            balances={balances}
            deals={deals}
            loading={loading}
            onAddCurator={addCurator}
            onUpdateCurator={updateCurator}
            onAddPurchase={addCuratorPurchase}
            onArchiveCurator={archiveCurator}
            onDeleteCurator={deleteCurator}
            onPauseCurator={pauseCurator}
            hideAddButton
            creatingOpen={addCuratorOpen}
            onCreatingOpenChange={setAddCuratorOpen}
          />
        ) : (
          <>
            {/* OutreachDashboard só no desktop — no mobile o funil único já cobre */}
            <div className="hidden lg:block">
              <OutreachDashboard />
            </div>
            <CuradoresCRM segment="prospeccao" />
          </>
        )}
        </section>
      </PageContainer>
    </>
  );
}
