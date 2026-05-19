import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ListMusic, Plus, CheckCircle2, Layers, Activity, Target, Users, Receipt, User, ChevronDown, Briefcase, Filter, Check } from "lucide-react";
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
import { DealRow } from "@/components/playlist-deals/DealRow";
import { useNavigate, useSearchParams } from "react-router-dom";
import { NewDealDialog } from "@/components/playlist-deals/NewDealDialog";
import { DuplicateDealDialog } from "@/components/playlist-deals/DuplicateDealDialog";
import { LogPrintDialog } from "@/components/playlist-deals/LogPrintDialog";
import { DealHistorySheet } from "@/components/playlist-deals/DealHistorySheet";
import { CloseDealDialog } from "@/components/playlist-deals/CloseDealDialog";
import { FinanceiroTab } from "@/components/playlist-deals/FinanceiroTab";


type DealsTab = "active" | "done" | "ledger" | "all";

const TABS = [
  { id: "active"   as const, label: "Ativos",      icon: Activity },
  { id: "done"     as const, label: "Concluídos",  icon: CheckCircle2 },
  { id: "ledger"   as const, label: "Financeiro",  icon: Receipt },
  { id: "all"      as const, label: "Todos",       icon: Layers },
];

export default function PlaylistDeals() {
  const [tab, setTab] = useScreenField<DealsTab>("/playlist-deals", "tab", "active");
  const [activeSubFilter, setActiveSubFilter] = useScreenField<"all" | "running" | "waiting">("/playlist-deals", "activeSub", "all");
  const [artistFilter, setArtistFilter] = useScreenField<string>("/playlist-deals", "artist", "");
  const [newOpen, setNewOpen] = useState(false);
  const [logDeal, setLogDeal] = useState<CuratorDeal | null>(null);
  const [detailDeal, setDetailDeal] = useState<CuratorDeal | null>(null);
  const [editDeal, setEditDeal] = useState<CuratorDeal | null>(null);
  const [duplicateDeal, setDuplicateDeal] = useState<CuratorDeal | null>(null);
  const [closeDealOpen, setCloseDealOpen] = useState<CuratorDeal | null>(null);

  // Pré-fill vindo de /sistema (painel de Recomendações)
  const [prefillSongUrl, setPrefillSongUrl] = useState<string | null>(null);
  const [prefillCuratorId, setPrefillCuratorId] = useState<string | null>(null);
  const [sourceFitId, setSourceFitId] = useState<string | null>(null);

  const { deals, logs, playlists, songs, alerts, curators, balances, progressByDeal, loading, deleteDeal, addLog, addBaseline, insertSnapshots, closeDeal, reopenDeal, forceCollectNow, updateCurator, addCuratorPurchase, archiveCurator, deleteCurator, pauseCurator, reload } = useCuratorDeals();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const useLegacyCards = searchParams.get("legacy") === "1";
  const navigate = useNavigate();

  // Resolve curador a partir do link da playlist e abre o NewDealDialog
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    const songUrl = searchParams.get("prefill_song_url");
    const playlistUrl = searchParams.get("prefill_playlist_url");
    const fitId = searchParams.get("from_fit");
    if (!songUrl) return;

    setPrefillSongUrl(songUrl);
    setSourceFitId(fitId);

    const m = playlistUrl?.match(/playlist[/:]([a-zA-Z0-9]{10,})/);
    const playlistId = m?.[1] ?? null;

    (async () => {
      let curatorId: string | null = null;
      if (playlistId) {
        const { data } = await supabase
          .from("curator_playlists")
          .select("deal_id")
          .eq("spotify_playlist_id", playlistId)
          .limit(50);
        const dealIds = Array.from(new Set((data ?? []).map((r: any) => r.deal_id).filter(Boolean)));
        if (dealIds.length > 0) {
          const { data: dealsData } = await supabase
            .from("curator_deals")
            .select("curator_id")
            .in("id", dealIds);
          const counts = new Map<string, number>();
          for (const d of (dealsData ?? []) as any[]) {
            if (!d.curator_id) continue;
            counts.set(d.curator_id, (counts.get(d.curator_id) ?? 0) + 1);
          }
          let best: string | null = null;
          let bestN = 0;
          counts.forEach((n, id) => { if (n > bestN) { bestN = n; best = id; } });
          curatorId = best;
        }
      }
      setPrefillCuratorId(curatorId);
      setNewOpen(true);
      const next = new URLSearchParams(searchParams);
      ["new", "from_fit", "prefill_song_url", "prefill_playlist_url"].forEach((k) => next.delete(k));
      setSearchParams(next, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDealCreatedFromFit = async (deal: CuratorDeal) => {
    if (!sourceFitId) return;
    try {
      await supabase
        .from("recommendation_feedback")
        .update({ deal_id: deal.id } as any)
        .eq("fit_id", sourceFitId);
    } catch (e) {
      console.error("[PlaylistDeals] feedback.deal_id update failed", e);
    }
  };
  const openDetail = (deal: CuratorDeal) => {
    if (useLegacyCards) setDetailDeal(deal);
    else navigate(`/playlist-deals/${deal.id}`);
  };

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

  const dealsWithBaseline = useMemo(
    () => new Set(logs.filter((l) => l.is_baseline).map((l) => l.deal_id)),
    [logs],
  );

  const activeCounts = useMemo(() => {
    const actives = deals.filter((d) => !d.closed_at);
    let running = 0;
    let waiting = 0;
    for (const d of actives) {
      if (dealsWithBaseline.has(d.id)) running++;
      else waiting++;
    }
    return { all: actives.length, running, waiting };
  }, [deals, dealsWithBaseline]);

  // Artistas disponíveis na aba atual (antes do filtro por artista)
  const artistsAvailable = useMemo(() => {
    const base =
      tab === "done" ? deals.filter((d) => !!d.closed_at)
      : tab === "active" ? deals.filter((d) => !d.closed_at)
      : deals;
    const set = new Map<string, number>();
    for (const d of base) {
      const a = (d.song_name ?? "").trim();
      if (!a) continue;
      set.set(a, (set.get(a) ?? 0) + 1);
    }
    return Array.from(set.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [deals, tab]);

  // Se o artista filtrado não existe mais na aba, reseta
  useEffect(() => {
    if (artistFilter && !artistsAvailable.some((a) => a.name === artistFilter)) {
      setArtistFilter("");
    }
  }, [artistFilter, artistsAvailable, setArtistFilter]);

  const filtered = useMemo(() => {
    let base =
      tab === "done" ? deals.filter((d) => !!d.closed_at)
      : tab === "active" ? deals.filter((d) => !d.closed_at)
      : deals;

    if (tab === "active") {
      if (activeSubFilter === "running") base = base.filter((d) => dealsWithBaseline.has(d.id));
      else if (activeSubFilter === "waiting") base = base.filter((d) => !dealsWithBaseline.has(d.id));
    }

    if (artistFilter) {
      base = base.filter((d) => (d.song_artist ?? "").trim() === artistFilter);
    }
    // Agrupa por CAMPANHA (mesmo nome de música fica junto), independente de curador.
    // Dentro de cada campanha: ativos com baseline > ativos sem baseline > encerrados.
    // Ordem das campanhas: a primeira campanha que tiver um deal "mais ativo" aparece antes.
    const rank = (d: typeof deals[number]) =>
      d.closed_at ? 2 : dealsWithBaseline.has(d.id) ? 0 : 1;
    const campaignKey = (d: typeof deals[number]) =>
      (d.song_name ?? "").trim().toLowerCase() || `__deal_${d.id}`;

    // Menor rank por campanha define a ordem das campanhas.
    const bestRankByCampaign = new Map<string, number>();
    for (const d of base) {
      const k = campaignKey(d);
      const r = rank(d);
      const prev = bestRankByCampaign.get(k);
      if (prev === undefined || r < prev) bestRankByCampaign.set(k, r);
    }
    // Ordem de primeira aparição (estabilidade) dentro do mesmo bestRank.
    const campaignOrder = new Map<string, number>();
    let idx = 0;
    [...base]
      .sort((a, b) => (bestRankByCampaign.get(campaignKey(a))! - bestRankByCampaign.get(campaignKey(b))!))
      .forEach((d) => {
        const k = campaignKey(d);
        if (!campaignOrder.has(k)) campaignOrder.set(k, idx++);
      });

    return [...base].sort((a, b) => {
      const ka = campaignKey(a);
      const kb = campaignKey(b);
      if (ka !== kb) {
        const br = bestRankByCampaign.get(ka)! - bestRankByCampaign.get(kb)!;
        if (br !== 0) return br;
        return (campaignOrder.get(ka) ?? 0) - (campaignOrder.get(kb) ?? 0);
      }
      // mesma campanha: ativos primeiro
      return rank(a) - rank(b);
    });
  }, [deals, dealsWithBaseline, tab, activeSubFilter, artistFilter]);

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
    return kpi.active;
  };

  return (
    <PageContainer>
      <PageHeader
        title="Playlist Deals"
        subtitle="Acompanhar deals com curadores"
        domain="deals"
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
                onClick={() => navigate("/clientes")}
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
          domain="deals"
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={Activity}
          label="Ativos"
          value={formatNumber(kpi.active)}
          hint="Em andamento"
          domain="campaigns"
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={CheckCircle2}
          label="Concluídos"
          value={formatNumber(kpi.done)}
          hint="Meta batida"
          domain="deals"
          loading={loading && deals.length === 0}
        />
        <KpiBig
          icon={Target}
          label="Plays entregues"
          value={formatNumber(kpi.earned)}
          hint={kpi.total > 0 ? `${kpi.pct}% das metas` : "Sem metas ainda"}
          domain="playlists"
          loading={loading && deals.length === 0}
        />
      </section>

      {/* TABS — mesmo padrão visual de Operação (border-b + ícone + label) */}
      <div className="sticky top-0 z-30 -mt-px bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md border-b border-border -mx-4 md:-mx-6">
        <div className="nx-tab-rail items-center gap-1 px-4 md:px-6">
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
      </div>

      {/* Sub-filtros: estado (Ativos) + filtro por músico */}
      {tab !== "ledger" && (deals.length > 0) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {tab === "active" && activeCounts.all > 0 && ([
            { id: "all" as const,     label: "Todos",             count: activeCounts.all },
            { id: "running" as const, label: "Rodando",           count: activeCounts.running },
            { id: "waiting" as const, label: "Aguardando início", count: activeCounts.waiting },
          ]).map((f) => {
            const isActive = activeSubFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setActiveSubFilter(f.id)}
                className={cn(
                  "h-8 px-3 inline-flex items-center gap-1.5 rounded-full text-[12px] font-medium border transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:bg-muted/40",
                )}
              >
                {f.label}
                <span className={cn(
                  "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums",
                  isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                )}>
                  {f.count}
                </span>
              </button>
            );
          })}

          {artistsAvailable.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "h-8 px-3 inline-flex items-center gap-1.5 rounded-full text-[12px] font-medium border transition-colors",
                    artistFilter
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:bg-muted/40",
                  )}
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span className="max-w-[140px] truncate">
                    {artistFilter || "Músico"}
                  </span>
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60 max-h-80 overflow-y-auto">
                <DropdownMenuItem onClick={() => setArtistFilter("")} className="gap-2">
                  {!artistFilter ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
                  <span>Todos os músicos</span>
                </DropdownMenuItem>
                {artistsAvailable.map((a) => (
                  <DropdownMenuItem
                    key={a.name}
                    onClick={() => setArtistFilter(a.name)}
                    className="gap-2"
                  >
                    {artistFilter === a.name ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
                    <span className="truncate flex-1">{a.name}</span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">{a.count}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {/* Conteúdo — altura mínima estável evita layout shift entre abas */}
      <div className="min-h-[480px] animate-tab-in">
        {tab === "ledger" ? (
          <FinanceiroTab deals={deals} />
        ) : loading && deals.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="nx-card h-56 animate-pulse" />
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
        ) : useLegacyCards ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {filtered.map((d) => (
              <CuratorDealCard
                key={d.id}
                deal={d}
                logs={logs}
                playlists={playlists}
                progress={progressByDeal[d.id]}
                songs={songs.filter((s) => s.deal_id === d.id)}
                onLog={(deal) => setLogDeal(deal)}
                onDetail={openDetail}
                onDelete={(deal) => handleDelete(deal.id)}
                onEdit={(deal) => setEditDeal(deal)}
                onDuplicate={(deal) => setDuplicateDeal(deal)}
                onClose={(deal) => setCloseDealOpen(deal)}
                onReopen={handleReopen}
                onForceCollect={(deal) => forceCollectNow(deal.id)}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {filtered.map((d) => (
              <DealRow
                key={d.id}
                deal={d}
                logs={logs}
                playlists={playlists}
                progress={progressByDeal[d.id]}
                songs={songs.filter((s) => s.deal_id === d.id)}
                onLog={(deal) => setLogDeal(deal)}
                onDetail={openDetail}
                onDelete={(deal) => handleDelete(deal.id)}
                onEdit={(deal) => setEditDeal(deal)}
                onDuplicate={(deal) => setDuplicateDeal(deal)}
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
            setPrefillSongUrl(null);
            setPrefillCuratorId(null);
            setSourceFitId(null);
          } else if (!editDeal) {
            setNewOpen(true);
          }
        }}
        editDeal={editDeal}
        editSongs={editDeal ? songs.filter((s) => s.deal_id === editDeal.id) : []}
        onSaved={reload}
        prefillSongUrl={editDeal ? null : prefillSongUrl}
        prefillCuratorId={editDeal ? null : prefillCuratorId}
        sourceFitId={editDeal ? null : sourceFitId}
        onCreated={handleDealCreatedFromFit}
      />

      <DuplicateDealDialog
        open={duplicateDeal !== null}
        onOpenChange={(v) => { if (!v) setDuplicateDeal(null); }}
        sourceDeal={duplicateDeal}
        sourceSongs={duplicateDeal ? songs.filter((s) => s.deal_id === duplicateDeal.id) : []}
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
