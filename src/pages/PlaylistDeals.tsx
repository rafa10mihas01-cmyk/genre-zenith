import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ListMusic,
  Plus,
  CheckCircle2,
  Activity,
  Target,
  ChevronDown,
  Filter,
  Check,
  List,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
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
import { useDeliveryStatusMap } from "@/hooks/useDeliveryStatus";
import { computeCuratorStats, type CuratorDeal } from "@/lib/curatorDealsUtils";
import { formatNumber } from "@/lib/format";
import { DealRow } from "@/components/playlist-deals/DealRow";
import { useNavigate, useSearchParams } from "react-router-dom";
import { NewDealDialog } from "@/components/playlist-deals/NewDealDialog";
import { DuplicateDealDialog } from "@/components/playlist-deals/DuplicateDealDialog";
import { LogPrintDialog } from "@/components/playlist-deals/LogPrintDialog";
import { DealHistorySheet } from "@/components/playlist-deals/DealHistorySheet";
import { CloseDealDialog } from "@/components/playlist-deals/CloseDealDialog";

type DealsTab = "active" | "done" | "all";
type OriginFilter = "all" | "manual" | "campaign";

const TABS = [
  { id: "active" as const, label: "Ativos", icon: Activity },
  { id: "done" as const, label: "Concluídos", icon: CheckCircle2 },
  { id: "all" as const, label: "Todos", icon: List },
];

const PAGE_SIZE = 24;

function filterByTab(deals: CuratorDeal[], tab: DealsTab): CuratorDeal[] {
  switch (tab) {
    case "done":
      return deals.filter((d) => !!d.closed_at);
    case "active":
      return deals.filter((d) => !d.closed_at);
    case "all":
    default:
      return deals;
  }
}

export default function PlaylistDeals() {
  const [tabRaw, setTab] = useScreenField<DealsTab>("/deals", "tab", "active");
  const tab: DealsTab = tabRaw === "active" || tabRaw === "done" || tabRaw === "all" ? tabRaw : "active";

  const [artistFilter, setArtistFilter] = useScreenField<string>("/deals", "artist", "");
  const [originFilter, setOriginFilter] = useScreenField<OriginFilter>("/deals", "origin", "all");
  const [search, setSearch] = useScreenField<string>("/deals", "q", "");
  const [page, setPage] = useState(1);

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

  const { deals, logs, playlists, songs, progressByDeal, loading, deleteDeal, closeDeal, reopenDeal, forceCollectNow, reload } = useCuratorDeals();

  // Mapa id->collection_mode das campanhas vinculadas (pra mostrar "Coleta Spotify/Excel" nos cards)
  const [campaignModeById, setCampaignModeById] = useState<Record<string, string | null>>({});
  const campaignIdsKey = useMemo(
    () => Array.from(new Set(deals.map((d) => d.campaign_id).filter(Boolean))).sort().join(","),
    [deals],
  );
  useEffect(() => {
    const ids = campaignIdsKey ? campaignIdsKey.split(",") : [];
    if (ids.length === 0) {
      setCampaignModeById({});
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("campaigns")
        .select("id, collection_mode")
        .in("id", ids);
      const map: Record<string, string | null> = {};
      for (const c of (data ?? []) as any[]) map[c.id] = c.collection_mode ?? null;
      setCampaignModeById(map);
    })();
  }, [campaignIdsKey]);

  const [searchParams, setSearchParams] = useSearchParams();
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
          // Separação operacional × observacional
          .from("v_curator_playlists_operational")
          .select("deal_id")
          .eq("spotify_playlist_id", playlistId)
          .limit(50);
        const dealIds = Array.from(new Set((data ?? []).map((r) => r.deal_id).filter(Boolean)));
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
      console.error("[Deals] feedback.deal_id update failed", e);
    }
  };

  const openDetail = (deal: CuratorDeal) => navigate(`/deals/${deal.id}`);

  // KPIs do topo
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
      if (d.closed_at) done++;
      else active++;
    }
    const pct = totalTarget > 0 ? Math.round((totalEarned / totalTarget) * 100) : 0;
    const fromCampaign = deals.filter((d) => d.origin === "campaign").length;
    const campaignPct = deals.length > 0 ? Math.round((fromCampaign / deals.length) * 100) : 0;
    return { total: deals.length, active, done, earned: totalEarned, pct, fromCampaign, campaignPct };
  }, [deals, logs, playlists, progressByDeal]);

  useSetSidebarKpis(
    deals.length > 0
      ? [
          { label: "Ativos", value: kpi.active, intent: "primary" },
          { label: "Concluídos", value: kpi.done, intent: "success" },
          { label: "Total", value: kpi.total, intent: "default" },
        ]
      : [],
  );

  const dealsWithBaseline = useMemo(
    () => new Set(logs.filter((l) => l.is_initial_capture_event).map((l) => l.deal_id)),
    [logs],
  );

  // Artistas/Músicas disponíveis na aba atual (antes do filtro por música)
  const artistsAvailable = useMemo(() => {
    const base = filterByTab(deals, tab);
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

  useEffect(() => {
    if (artistFilter && !artistsAvailable.some((a) => a.name === artistFilter)) {
      setArtistFilter("");
    }
  }, [artistFilter, artistsAvailable, setArtistFilter]);

  const filtered = useMemo(() => {
    let base = filterByTab(deals, tab);

    if (artistFilter) {
      base = base.filter((d) => (d.song_name ?? "").trim() === artistFilter);
    }

    if (originFilter !== "all") {
      base = base.filter((d) => {
        const effective = d.campaign_id ? "campaign" : (d.origin ?? "manual");
        return effective === originFilter;
      });
    }

    const q = search.trim().toLowerCase();
    if (q) {
      base = base.filter((d) => {
        const hay = [d.song_name, d.song_artist, d.curator_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    // Ordem: ativos com baseline > ativos sem baseline > encerrados, agrupados por campanha.
    const rank = (d: typeof deals[number]) =>
      d.closed_at ? 2 : dealsWithBaseline.has(d.id) ? 0 : 1;
    const campaignKey = (d: typeof deals[number]) =>
      (d.song_name ?? "").trim().toLowerCase() || `__deal_${d.id}`;

    const bestRankByCampaign = new Map<string, number>();
    for (const d of base) {
      const k = campaignKey(d);
      const r = rank(d);
      const prev = bestRankByCampaign.get(k);
      if (prev === undefined || r < prev) bestRankByCampaign.set(k, r);
    }
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
      return rank(a) - rank(b);
    });
  }, [deals, dealsWithBaseline, tab, artistFilter, originFilter, search]);

  // Reset paginação ao mudar filtros
  useEffect(() => {
    setPage(1);
  }, [tab, artistFilter, originFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );
  const pagedIds = useMemo(() => paged.map((d) => d.id), [paged]);
  const deliveryMap = useDeliveryStatusMap(pagedIds);

  const handleNew = () => setNewOpen(true);

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este deal e todo o histórico?")) return;
    try {
      await deleteDeal(id);
    } catch (e) {
      console.error("[Deals] delete error", e);
    }
  };

  const handleReopen = async (deal: CuratorDeal) => {
    if (!confirm(`Reabrir o deal de ${deal.curator_name}?`)) return;
    try {
      await reopenDeal(deal.id);
      toast.success("Deal reaberto");
    } catch (e) {
      console.error("[Deals] reopen error", e);
      toast.error("Erro ao reabrir deal");
    }
  };

  const tabCount = (id: DealsTab) => {
    if (id === "all") return kpi.total;
    if (id === "done") return kpi.done;
    return kpi.active;
  };

  const originLabel: Record<OriginFilter, string> = {
    all: "Todas as origens",
    manual: "Manual",
    campaign: "Campanha",
  };

  return (
    <PageContainer>
      <PageHeader
        title="Deals"
        subtitle="Curador, música e meta"
        domain="deals"
        manualKey="deals"
        actions={
          <Button onClick={handleNew} className="rounded-full h-9 gap-1.5" aria-label="Novo deal">
            <Plus className="h-4 w-4" /> <span className="truncate">Novo Deal</span>
          </Button>
        }
      />

      {/* KPIs — grid uniforme (4 cards de mesma largura) */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 md:pt-4">
        <KpiBig
          icon={Target}
          label="Plays entregues"
          value={formatNumber(kpi.earned)}
          hint={kpi.total > 0 ? `${kpi.pct}% das metas` : "Sem metas ainda"}
          domain="playlists"
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
          icon={ListMusic}
          label="Total de deals"
          value={formatNumber(kpi.total)}
          hint={
            kpi.total > 0
              ? `${kpi.campaignPct}% via campanha · ${kpi.total - kpi.fromCampaign} avulsos`
              : "Deals cadastrados"
          }
          domain="deals"
          loading={loading && deals.length === 0}
        />
      </section>

      {/* TABS — mobile: grid de cards; desktop: rail clássico */}
      <div className="grid grid-cols-3 gap-1.5 sm:hidden">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-xl border px-1 py-2 flex flex-col items-center justify-center gap-1 transition-colors",
                active
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={active}
            >
              <Icon className={cn("h-4 w-4", active ? "text-primary" : "")} />
              <span className="text-[11px] font-medium leading-none">{t.label}</span>
              <span className={cn("text-[11px] font-bold tabular-nums leading-none", active ? "text-primary" : "text-muted-foreground")}>
                {tabCount(t.id)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="hidden sm:block sticky top-0 z-30 -mt-px bg-background border-b border-border -mx-4 md:-mx-6">
        <div className="nx-tab-rail items-center gap-1 px-4 md:px-6 flex">
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-none">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex-none px-4 h-10 inline-flex items-center justify-center gap-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t.label}</span>
                  <span
                    className={cn(
                      "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums shrink-0",
                      active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {tabCount(t.id)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Busca + filtros */}
      <div className="flex flex-row items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por música, artista ou curador…"
            className="w-full h-9 pl-9 pr-3 rounded-full bg-card border border-border text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/30"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "h-9 px-3 inline-flex items-center gap-1.5 rounded-full text-[12px] font-medium border transition-colors",
                  originFilter !== "all"
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:bg-muted/40",
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                <span className="max-w-[140px] truncate">{originLabel[originFilter]}</span>
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {(["all", "manual", "campaign"] as OriginFilter[]).map((o) => (
                <DropdownMenuItem key={o} onClick={() => setOriginFilter(o)} className="gap-2">
                  {originFilter === o ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
                  <span>{originLabel[o]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {artistsAvailable.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "h-9 px-3 inline-flex items-center gap-1.5 rounded-full text-[12px] font-medium border transition-colors",
                    artistFilter
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:bg-muted/40",
                  )}
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span className="max-w-[140px] truncate">{artistFilter || "Música"}</span>
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 max-h-80 overflow-y-auto">
                <DropdownMenuItem onClick={() => setArtistFilter("")} className="gap-2">
                  {!artistFilter ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
                  <span>Todas as músicas</span>
                </DropdownMenuItem>
                {artistsAvailable.map((a) => (
                  <DropdownMenuItem key={a.name} onClick={() => setArtistFilter(a.name)} className="gap-2">
                    {artistFilter === a.name ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
                    <span className="truncate flex-1">{a.name}</span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">{a.count}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Conteúdo */}
      <div className="min-h-[480px] animate-tab-in">
        {loading && deals.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
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
                  {deals.length === 0 ? "Sem deals" : "Vazio"}
                </div>
                <div className="text-[13px] text-muted-foreground leading-relaxed">
                  {deals.length === 0
                    ? "Crie seu primeiro deal para começar a acompanhar curadores, metas e plays entregues."
                    : "Tente outra aba ou ajuste os filtros."}
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
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
              {paged.map((d) => (
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
                  campaignCollectionMode={d.campaign_id ? campaignModeById[d.campaign_id] ?? null : null}
                  deliveryRow={deliveryMap[d.id] ?? null}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 px-1">
                <div className="text-[12px] text-muted-foreground tabular-nums">
                  {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} de {filtered.length}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2.5 gap-1"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Anterior
                  </Button>
                  <span className="text-[12px] text-muted-foreground tabular-nums px-2">
                    {safePage} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2.5 gap-1"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Próxima <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </>
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
