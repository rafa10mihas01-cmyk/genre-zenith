import { useMemo, useState } from "react";
import { ListMusic, Plus, CheckCircle2, Layers, Activity, Target } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { KpiBig } from "@/components/KpiBig";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useSetSidebarKpis } from "@/contexts/SidebarContext";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import { computeCuratorStats, type CuratorDeal } from "@/lib/curatorDealsUtils";
import { formatNumber } from "@/lib/format";
import { CuratorDealCard } from "@/components/playlist-deals/CuratorDealCard";
import { NewDealDialog } from "@/components/playlist-deals/NewDealDialog";
import { LogPrintDialog } from "@/components/playlist-deals/LogPrintDialog";
import { DealHistorySheet } from "@/components/playlist-deals/DealHistorySheet";

type DealsTab = "active" | "done" | "all";

const TABS = [
  { id: "active" as const, label: "Ativos",      icon: Activity },
  { id: "done"   as const, label: "Concluídos",  icon: CheckCircle2 },
  { id: "all"    as const, label: "Todos",       icon: Layers },
];

export default function PlaylistDeals() {
  const [tab, setTab] = usePersistedState<DealsTab>("playlistdeals:tab", "active");
  const [newOpen, setNewOpen] = useState(false);
  const [logDeal, setLogDeal] = useState<CuratorDeal | null>(null);
  const [detailDeal, setDetailDeal] = useState<CuratorDeal | null>(null);

  const { deals, logs, playlists, songs, loading, deleteDeal, addLog, addBaseline, reload } = useCuratorDeals();

  // KPIs do topo — derivados dos deals + logs + playlists
  const kpi = useMemo(() => {
    let active = 0;
    let done = 0;
    let totalEarned = 0;
    let totalTarget = 0;
    for (const d of deals) {
      const { earned } = computeCuratorStats(d, logs, playlists);
      const target = Number(d.target_plays ?? 0);
      totalEarned += earned;
      totalTarget += target;
      if (target > 0 && earned >= target) done++;
      else active++;
    }
    const pct = totalTarget > 0 ? Math.round((totalEarned / totalTarget) * 100) : 0;
    return {
      total: deals.length,
      active,
      done,
      earned: totalEarned,
      pct,
    };
  }, [deals, logs, playlists]);

  // Sidebar KPIs — ativos / concluídos / total
  useSetSidebarKpis(
    deals.length > 0
      ? [
          { label: "Ativos",     value: kpi.active, intent: "primary" },
          { label: "Concluídos", value: kpi.done,   intent: "success" },
          { label: "Total",      value: kpi.total,  intent: "default" },
        ]
      : [],
  );

  const filtered = useMemo(() => {
    if (tab === "all") return deals;
    return deals.filter((d) => {
      const { earned } = computeCuratorStats(d, logs, playlists);
      const isDone =
        Number(d.target_plays ?? 0) > 0 && earned >= Number(d.target_plays);
      return tab === "done" ? isDone : !isDone;
    });
  }, [deals, logs, playlists, tab]);

  const handleNew = () => setNewOpen(true);

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este deal e todo o histórico?")) return;
    try {
      await deleteDeal(id);
    } catch (e) {
      console.error("[PlaylistDeals] delete error", e);
    }
  };

  const tabCount = (id: DealsTab) => {
    if (id === "all") return kpi.total;
    if (id === "done") return kpi.done;
    return kpi.active;
  };

  return (
    <PageContainer>
      <PageHeader
        title="Playlist Deals"
        subtitle="Acompanhar deals com curadores"
        actions={
          <Button className="rounded-full h-9 gap-1.5" onClick={handleNew}>
            <Plus className="h-4 w-4" /> Novo Deal
          </Button>
        }
      />

      {/* KPIs — padrão idêntico a Operação / Criação / Performance */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig
          icon={ListMusic}
          label="Total de deals"
          value={formatNumber(kpi.total)}
          hint="Deals cadastrados"
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={Activity}
          label="Ativos"
          value={formatNumber(kpi.active)}
          tone="primary"
          hint="Em andamento"
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={CheckCircle2}
          label="Concluídos"
          value={formatNumber(kpi.done)}
          tone="success"
          hint="Meta batida"
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={Target}
          label="Plays entregues"
          value={formatNumber(kpi.earned)}
          tone={kpi.pct >= 80 ? "success" : kpi.pct >= 40 ? "primary" : "default"}
          hint={kpi.total > 0 ? `${kpi.pct}% das metas` : "Sem metas ainda"}
          loading={loading && deals.length === 0}
        />
      </section>

      {/* TABS — mesmo padrão visual de Operação (border-b + ícone + label) */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              <span
                className={cn(
                  "ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold tabular-nums",
                  active
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {tabCount(t.id)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Conteúdo — altura mínima estável evita layout shift entre abas */}
      <div className="min-h-[480px] animate-tab-in">
        {loading && deals.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="nx-card h-48 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="nx-card">
            <div className="py-10 flex flex-col items-center text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-elevated border border-border flex items-center justify-center">
                <ListMusic className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <div className="font-semibold text-foreground">
                  {deals.length === 0 ? "Nenhum deal ainda" : "Nada nesta aba"}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {deals.length === 0
                    ? "Clique em + Novo Deal para começar"
                    : "Tente outra aba"}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((d) => (
              <CuratorDealCard
                key={d.id}
                deal={d}
                logs={logs}
                playlists={playlists}
                songs={songs.filter((s) => s.deal_id === d.id)}
                onLog={(deal) => setLogDeal(deal)}
                onDetail={(deal) => setDetailDeal(deal)}
                onDelete={(deal) => handleDelete(deal.id)}
              />
            ))}
          </div>
        )}
      </div>

      <NewDealDialog open={newOpen} onOpenChange={setNewOpen} />

      <LogPrintDialog
        open={logDeal !== null}
        deal={logDeal}
        allLogs={logs}
        allPlaylists={playlists}
        onClose={() => setLogDeal(null)}
        addLog={addLog}
        addBaseline={addBaseline}
      />

      <DealHistorySheet
        open={detailDeal !== null}
        deal={detailDeal}
        allLogs={logs}
        allPlaylists={playlists}
        onClose={() => setDetailDeal(null)}
        onReload={reload}
      />
    </PageContainer>
  );
}
