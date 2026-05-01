import { useMemo, useState } from "react";
import { ListMusic, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import { computeCuratorStats, type CuratorDeal } from "@/lib/curatorDealsUtils";
import { CuratorDealCard } from "@/components/playlist-deals/CuratorDealCard";
import { NewDealDialog } from "@/components/playlist-deals/NewDealDialog";
import { LogPrintDialog } from "@/components/playlist-deals/LogPrintDialog";
import { DealHistorySheet } from "@/components/playlist-deals/DealHistorySheet";

type DealsTab = "active" | "done" | "all";

const TABS: { id: DealsTab; label: string }[] = [
  { id: "active", label: "Ativos" },
  { id: "done",   label: "Concluídos" },
  { id: "all",    label: "Todos" },
];

export default function PlaylistDeals() {
  const [tab, setTab] = usePersistedState<DealsTab>("playlistdeals:tab", "active");
  const [newOpen, setNewOpen] = useState(false);
  const [logDeal, setLogDeal] = useState<CuratorDeal | null>(null);
  const [detailDeal, setDetailDeal] = useState<CuratorDeal | null>(null);

  const { deals, logs, playlists, loading, deleteDeal } = useCuratorDeals();

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

  return (
    <div className="w-full space-y-6">
      <PageHeader
        kicker="Módulo"
        icon={ListMusic}
        title="Playlist Deals"
        subtitle="Acompanhar deals com curadores"
        actions={
          <Button className="rounded-full h-9 gap-1.5" onClick={handleNew}>
            <Plus className="h-4 w-4" /> Novo Deal
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => {
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
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="min-h-[400px]">
        {loading && deals.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                    ? "Clique em + Novo para começar"
                    : "Tente outra aba"}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((d) => (
              <CuratorDealCard
                key={d.id}
                deal={d}
                logs={logs}
                playlists={playlists}
                onLog={(deal) => setLogDeal(deal)}
                onDetail={(deal) => setDetailDeal(deal)}
                onDelete={(deal) => handleDelete(deal.id)}
              />
            ))}
          </div>
        )}
      </div>

      <NewDealDialog open={newOpen} onOpenChange={setNewOpen} />

      {/* LogPrintDialog e DealHistorySheet serão migrados para o novo
          modelo nos próximos prompts; por ora mantemos fechados. */}
      <LogPrintDialog
        open={false}
        deal={null}
        allLogs={[]}
        onClose={() => setLogDeal(null)}
        addLog={async () => {
          throw new Error("Migração pendente");
        }}
      />

      <DealHistorySheet
        open={false}
        deal={null}
        allLogs={[]}
        onClose={() => setDetailDeal(null)}
      />
    </div>
  );
}
