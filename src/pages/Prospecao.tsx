import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Handshake, UserSearch, Users, Activity, DollarSign, TrendingUp, Send, Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { KpiBig } from "@/components/KpiBig";
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

export default function Prospecao() {
  const [segment, setSegment] = useState<Segment>("ativos");
  const {
    curators, balances, deals, loading,
    updateCurator, addCuratorPurchase, archiveCurator, deleteCurator, pauseCurator,
    reload,
  } = useCuratorDeals();

  const ativosCount = curators.filter((c) => !c.archived_at).length;

  const kpisAtivos = useMemo(() => {
    const activeCurators = curators.filter((c) => !c.archived_at);
    const dealsAtivos = deals.filter((d) => !d.closed_at).length;
    const receita = balances.reduce((acc, b) => acc + (Number(b.total_cost) || 0), 0);
    const totalDeals = deals.length;
    const ticket = totalDeals > 0 ? receita / totalDeals : 0;
    return { curadores: activeCurators.length, dealsAtivos, receita, ticket };
  }, [curators, balances, deals]);

  // Outreach KPIs (carrega quando entra em prospecção)
  const [outreach, setOutreach] = useState({ leads: 0, contatados: 0, respondidos: 0, convertidos: 0, loading: true });
  useEffect(() => {
    if (segment !== "prospeccao") return;
    let cancelled = false;
    (async () => {
      setOutreach((s) => ({ ...s, loading: true }));
      const [extRes, logsRes] = await Promise.all([
        supabase.from("external_curators").select("id, pipeline_status"),
        supabase.from("curator_outreach_log").select("curator_id, event_type"),
      ]);
      if (cancelled) return;
      const ext = (extRes.data ?? []) as { id: string; pipeline_status: string }[];
      const logs = (logsRes.data ?? []) as { curator_id: string; event_type: string }[];
      const leads = ext.length;
      const contatadosSet = new Set(
        logs.filter((l) => l.event_type === "sent" || l.event_type.startsWith("followup")).map((l) => l.curator_id),
      );
      const respondidosSet = new Set(logs.filter((l) => l.event_type === "replied").map((l) => l.curator_id));
      const convertidos = ext.filter((c) => c.pipeline_status === "fechado").length;
      setOutreach({
        leads,
        contatados: contatadosSet.size,
        respondidos: respondidosSet.size,
        convertidos,
        loading: false,
      });
    })();
    return () => { cancelled = true; };
  }, [segment]);

  const taxaResposta = outreach.contatados > 0 ? (outreach.respondidos / outreach.contatados) * 100 : 0;

  return (
    <>
      <PageHeader
        title="Curadores"
        subtitle="Ativos e prospecção"
        domain="curators"
        manualKey="curadores"
        actions={
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
        }
      />

      <PageContainer>

      {/* KPIs contextuais por segmento */}
      {segment === "ativos" ? (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiBig tier="hero" icon={Users} label="Curadores" value={formatNumber(kpisAtivos.curadores)} hint="Ativos na biblioteca" domain="curators" loading={loading} />
          <KpiBig icon={Activity} label="Deals ativos" value={formatNumber(kpisAtivos.dealsAtivos)} hint="Negociações em andamento" domain="campaigns" loading={loading} />
          <KpiBig icon={DollarSign} label="Receita" value={formatBRL(kpisAtivos.receita)} hint="Total investido em curadoria" domain="deals" loading={loading} />
          <KpiBig tier="quiet" icon={TrendingUp} label="Ticket médio" value={formatBRL(kpisAtivos.ticket)} hint={`Base ${formatNumber(deals.length)} deals`} domain="deals" loading={loading} />
        </section>
      ) : (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiBig tier="hero" icon={UserSearch} label="Leads" value={formatNumber(outreach.leads)} hint="Curadores na base de prospecção" domain="curators" loading={outreach.loading} />
          <KpiBig icon={Send} label="Contatados" value={formatNumber(outreach.contatados)} hint="Curadores que receberam abordagem" domain="campaigns" loading={outreach.loading} />
          <KpiBig icon={Mail} label="Taxa de resposta" value={`${taxaResposta.toFixed(0)}%`} hint={`${formatNumber(outreach.respondidos)} respostas`} domain="campaigns" loading={outreach.loading} />
          <KpiBig tier="quiet" icon={CheckCircle2} label="Convertidos" value={formatNumber(outreach.convertidos)} hint="Fechados como curador ativo" domain="deals" loading={outreach.loading} />
        </section>
      )}


      {/* Segmento de alto nível */}
      <div className="sticky top-0 z-30 -mt-px bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md border-b border-border -mx-4 md:-mx-6">
        <div className="nx-tab-rail items-center gap-1 px-4 md:px-6">
          {([
            { id: "ativos" as const,      label: "Ativos",     icon: Handshake,  count: ativosCount, hint: "Curadores com quem você já fechou deal" },
            { id: "prospeccao" as const,  label: "Prospecção", icon: UserSearch, count: null,        hint: "Contatos para abordar e negociar" },
          ]).map((t) => {
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
                {t.count !== null && (
                  <span className={cn(
                    "ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold tabular-nums",
                    active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  )}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section className="space-y-4 animate-tab-in" key={segment}>
        {segment === "ativos" ? (
          <CuradoresLibraryTab
            curators={curators}
            balances={balances}
            deals={deals}
            loading={loading}
            onUpdateCurator={updateCurator}
            onAddPurchase={addCuratorPurchase}
            onArchiveCurator={archiveCurator}
            onDeleteCurator={deleteCurator}
            onPauseCurator={pauseCurator}
          />
        ) : (
          <>
            <OutreachDashboard />
            <CuradoresCRM segment="prospeccao" />
          </>
        )}
        </section>
      </PageContainer>
    </>
  );
}
