import { useMemo, useState } from "react";
import { RefreshCw, Handshake, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { CuradoresCRM } from "@/components/operacao/CuradoresCRM";
import { CuradoresLibraryTab } from "@/components/playlist-deals/CuradoresLibraryTab";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import { cn } from "@/lib/utils";

type Segment = "ativos" | "prospeccao";

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

function MiniStat({ label, value, tone }: { label: string; value: string | number; tone?: "primary" | "warning" }) {
  return (
    <div className="nx-card !p-3">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={cn(
        "text-xl font-bold tabular-nums mt-0.5",
        tone === "primary" && "text-primary",
        tone === "warning" && "text-warning",
      )}>
        {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
      </div>
    </div>
  );
}

export default function Prospecao() {
  const [segment, setSegment] = useState<Segment>("ativos");
  const {
    curators, balances, deals, loading,
    updateCurator, addCuratorPurchase, archiveCurator, deleteCurator, pauseCurator,
    reload,
  } = useCuratorDeals();

  const ativosCount = curators.filter((c) => !c.archived_at).length;

  const ativosKpis = useMemo(() => {
    const activeCurators = curators.filter((c) => !c.archived_at);
    const dealsAtivos = deals.filter((d) => !d.closed_at).length;
    const receita = balances.reduce((acc, b) => acc + (Number(b.total_cost) || 0), 0);
    const totalDeals = deals.length;
    const ticket = totalDeals > 0 ? receita / totalDeals : 0;
    return {
      curadores: activeCurators.length,
      dealsAtivos,
      receita,
      ticket,
    };
  }, [curators, balances, deals]);

  return (
    <PageContainer>
      <PageHeader
        title="Curadores"
        subtitle="Curadores ativos em deals e prospecção de novos contatos"
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

      {/* Segmento de alto nível */}
      <div className="sticky top-0 z-30 -mt-px bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md border-b border-border -mx-4 md:-mx-6">
        <div className="nx-tab-rail items-center gap-1 px-4 md:px-6">
          {([
            { id: "ativos" as const,     label: "Ativos",     icon: Handshake,  count: ativosCount,        hint: "Curadores com quem você já fechou deal" },
            { id: "prospeccao" as const, label: "Prospecção", icon: UserSearch, count: null,                hint: "Contatos para abordar e negociar" },
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
          <>
            {/* KPIs Ativos */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <MiniStat label="Curadores" value={ativosKpis.curadores} />
              <MiniStat label="Deals ativos" value={ativosKpis.dealsAtivos} tone="primary" />
              <MiniStat label="Receita" value={formatBRL(ativosKpis.receita)} />
              <MiniStat label="Ticket médio" value={formatBRL(ativosKpis.ticket)} tone="primary" />
            </div>
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
          </>
        ) : (
          <CuradoresCRM segment="prospeccao" />
        )}
      </section>
    </PageContainer>
  );
}

