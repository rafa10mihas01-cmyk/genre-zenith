import { useMemo, useState } from "react";
import { ListMusic, Plus, CheckCircle2, Layers, Activity, Target, Users, Receipt, User, ChevronDown, Briefcase } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { KpiBig } from "@/components/KpiBig";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useScreenField } from "@/lib/screen-state";
import { useSetSidebarKpis } from "@/contexts/SidebarContext";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import { computeCuratorStats, type CuratorDeal } from "@/lib/curatorDealsUtils";
import { formatNumber } from "@/lib/format";
import { CuratorDealCard } from "@/components/playlist-deals/CuratorDealCard";
import { NewDealDialog } from "@/components/playlist-deals/NewDealDialog";
import { LogPrintDialog } from "@/components/playlist-deals/LogPrintDialog";
import { DealHistorySheet } from "@/components/playlist-deals/DealHistorySheet";
import { CuradoresLibraryTab } from "@/components/playlist-deals/CuradoresLibraryTab";
import { ClientesLibraryTab } from "@/components/playlist-deals/ClientesLibraryTab";
import { CloseDealDialog } from "@/components/playlist-deals/CloseDealDialog";
import { FinanceiroTab } from "@/components/playlist-deals/FinanceiroTab";
import { useClients } from "@/hooks/useClients";

type DealsTab = "clients" | "library" | "active" | "done" | "ledger" | "all";

const TABS = [
  { id: "clients"  as const, label: "Clientes",    icon: User },
  { id: "library"  as const, label: "Curadores",   icon: Users },
  { id: "active"   as const, label: "Ativos",      icon: Activity },
  { id: "done"     as const, label: "Concluídos",  icon: CheckCircle2 },
  { id: "ledger"   as const, label: "Financeiro",  icon: Receipt },
  { id: "all"      as const, label: "Todos",       icon: Layers },
];

export default function PlaylistDeals() {
  const [tab, setTab] = useScreenField<DealsTab>("/playlist-deals", "tab", "active");
  const [newOpen, setNewOpen] = useState(false);
  const [logDeal, setLogDeal] = useState<CuratorDeal | null>(null);
  const [detailDeal, setDetailDeal] = useState<CuratorDeal | null>(null);
  const [editDeal, setEditDeal] = useState<CuratorDeal | null>(null);
  const [closeDealOpen, setCloseDealOpen] = useState<CuratorDeal | null>(null);

  const { deals, logs, playlists, songs, alerts, curators, balances, progressByDeal, loading, deleteDeal, addLog, addBaseline, insertSnapshots, closeDeal, reopenDeal, forceCollectNow, updateCurator, archiveCurator, deleteCurator, pauseCurator, reload } = useCuratorDeals();
  const { clients } = useClients();

  // KPIs do topo — derivados dos deals + logs + playlists
  const kpi = useMemo(() => {
    let active = 0;
    let done = 0;
    let totalEarned = 0;
    let totalTarget = 0;
    for (const d of deals) {
      const { earned } = computeCuratorStats(d, logs, playlists, progressByDeal[d.id]);
      const target = Number(d.target_plays ?? 0);
      totalEarned += earned;
      totalTarget += target;
      // "Concluído" agora = fechado manualmente; "Ativo" = sem closed_at
      if (d.closed_at) done++;
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
  }, [deals, logs, playlists, progressByDeal]);

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
    if (tab === "done") return deals.filter((d) => !!d.closed_at);
    if (tab === "active") return deals.filter((d) => !d.closed_at);
    return deals;
  }, [deals, tab]);

  const handleNew = () => setNewOpen(true);

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este deal e todo o histórico?")) return;
    try {
      await deleteDeal(id);
    } catch (e) {
      console.error("[PlaylistDeals] delete error", e);
    }
  };

  const handleReopen = async (deal: CuratorDeal) => {
    if (!confirm(`Reabrir o deal de ${deal.curator_name}?`)) return;
    try {
      await reopenDeal(deal.id);
      toast.success("Deal reaberto");
    } catch (e) {
      console.error("[PlaylistDeals] reopen error", e);
      toast.error("Erro ao reabrir deal");
    }
  };

  const tabCount = (id: DealsTab) => {
    if (id === "all") return kpi.total;
    if (id === "done") return kpi.done;
    if (id === "library") return curators.filter((c) => !c.archived_at).length;
    if (id === "clients") return clients.filter((c) => !c.archived_at).length;
    return kpi.active;
  };

  return (
    <PageContainer>
      <PageHeader
        title="Playlist Deals"
        subtitle="Acompanhar deals com curadores"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="rounded-full h-9 gap-1.5 max-w-full" aria-label="Criar novo">
                <Plus className="h-4 w-4" /> <span className="truncate">Novo</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-80" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
              <DropdownMenuItem
                className="gap-2 rounded-lg items-start py-2"
                onClick={handleNew}
              >
                <Briefcase className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium leading-tight">Novo Deal</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">Curador + músicas + meta</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 rounded-lg items-start py-2"
                onClick={() => {
                  setTab("clients");
                  setTimeout(() => window.dispatchEvent(new CustomEvent("playlistdeals:new-client")), 50);
                }}
              >
                <User className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium leading-tight">Novo cliente</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">Artista ou label contratante</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {/* KPIs — padrão idêntico a Operação / Criação / Performance */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
      <div className="sticky top-0 z-30 -mt-px bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md flex items-center gap-1 border-b border-border overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 md:-mx-6 px-4 md:px-6">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 transition-colors -mb-px shrink-0 whitespace-nowrap",
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
        {tab === "clients" ? (
          <ClientesLibraryTab
            deals={deals}
            songs={songs}
            loading={loading}
          />
        ) : tab === "library" ? (
          <CuradoresLibraryTab
            curators={curators}
            balances={balances}
            deals={deals}
            loading={loading}
            onUpdateCurator={updateCurator}
            onArchiveCurator={archiveCurator}
            onDeleteCurator={deleteCurator}
            onPauseCurator={pauseCurator}
          />
        ) : tab === "ledger" ? (
          <FinanceiroTab deals={deals} />
        ) : loading && deals.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="nx-card h-48 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="nx-card">
            <div className="py-16 flex flex-col items-center text-center gap-4">
              <div className="h-14 w-14 rounded-2xl bg-[hsl(var(--elevated))] border border-border/60 flex items-center justify-center shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)]">
                <ListMusic className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <div className="text-[18px] font-semibold text-foreground">
                  {deals.length === 0 ? "Nenhum deal ainda" : "Nada nesta aba"}
                </div>
                <div className="text-[13px] text-muted-foreground leading-relaxed">
                  {deals.length === 0
                    ? "Crie seu primeiro deal para começar a acompanhar curadores, metas e plays entregues."
                    : "Tente outra aba ou crie um novo deal."}
                </div>
              </div>
              {deals.length === 0 && (
                <Button onClick={handleNew} className="rounded-full h-10 gap-1.5 mt-2">
                  <Plus className="h-4 w-4" /> Criar primeiro deal
                </Button>
              )}
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
                progress={progressByDeal[d.id]}
                songs={songs.filter((s) => s.deal_id === d.id)}
                onLog={(deal) => setLogDeal(deal)}
                onDetail={(deal) => setDetailDeal(deal)}
                onDelete={(deal) => handleDelete(deal.id)}
                onEdit={(deal) => setEditDeal(deal)}
                onClose={(deal) => setCloseDealOpen(deal)}
                onReopen={handleReopen}
                onForceCollect={(deal) => forceCollectNow(deal.id)}
              />
            ))}
          </div>
        )}
      </div>

      <NewDealDialog
        open={newOpen || editDeal !== null}
        onOpenChange={(v) => {
          if (!v) {
            setNewOpen(false);
            setEditDeal(null);
          } else if (!editDeal) {
            setNewOpen(true);
          }
        }}
        editDeal={editDeal}
        editSongs={editDeal ? songs.filter((s) => s.deal_id === editDeal.id) : []}
        onSaved={reload}
      />

      <LogPrintDialog
        open={logDeal !== null}
        deal={logDeal}
        songs={logDeal ? songs.filter((s) => s.deal_id === logDeal.id) : []}
        allLogs={logs}
        allPlaylists={playlists}
        progress={logDeal ? progressByDeal[logDeal.id] : null}
        onClose={() => setLogDeal(null)}
        onSaved={reload}
      />

      <DealHistorySheet
        open={detailDeal !== null}
        deal={detailDeal}
        songs={detailDeal ? songs.filter((s) => s.deal_id === detailDeal.id) : []}
        allLogs={logs}
        allPlaylists={playlists}
        progress={detailDeal ? progressByDeal[detailDeal.id] : null}
        onClose={() => setDetailDeal(null)}
        onReload={reload}
      />

      <CloseDealDialog
        open={closeDealOpen !== null}
        deal={closeDealOpen}
        songs={closeDealOpen ? songs.filter((s) => s.deal_id === closeDealOpen.id) : []}
        logs={logs}
        playlists={playlists}
        progress={closeDealOpen ? progressByDeal[closeDealOpen.id] : null}
        onClose={() => setCloseDealOpen(null)}
        onConfirm={closeDeal}
      />
    </PageContainer>
  );
}
