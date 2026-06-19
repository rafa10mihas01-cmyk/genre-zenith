// MusicasTab — lista de faixas do catálogo com métricas de distribuição + telemetria.
// Linha clicável → /catalogo/musica/:id. KPIs vivem no pai (Catalogo.tsx).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Music2, CheckCircle2, AlertTriangle, Clock, ChevronRight, ArrowUpDown, Target, TrendingUp, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricCell } from "@/components/ui/metric-cell";
import { Progress } from "@/components/ui/progress";
import { StatusDot, type StatusVariant } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import { AddCatalogTrackDialog } from "./AddCatalogTrackDialog";

type CatalogTrack = {
  id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  cover_url: string | null;
  isrc: string | null;
  status: string;
  added_at: string;
};
type DistributionStats = {
  catalog_track_id: string;
  placements_total: number;
  placements_pending: number;
  placements_active: number;
  placements_failed: number;
};
type Telemetry = {
  catalog_track_id: string;
  baseline_at: string | null;
  last_captured_at: string | null;
  last_plays_28d: number | null;
  growth_abs: number | null;
  growth_pct: number | null;
  snapshots_count: number;
};
type Row = CatalogTrack & { stats: DistributionStats | null; tel: Telemetry | null };

type FilterId = "all" | "active" | "failed" | "no_baseline";
type SortId = "added" | "growth" | "placements";

async function fetchAll(): Promise<Row[]> {
  const [tracksRes, statsRes, telRes] = await Promise.all([
    supabase.from("catalog_tracks").select("id, spotify_track_id, track_name, artist_name, cover_url, isrc, status, added_at").order("added_at", { ascending: false }).limit(200),
    supabase.from("v_catalog_track_distribution_stats").select("catalog_track_id, placements_total, placements_pending, placements_active, placements_failed"),
    supabase.from("v_catalog_track_telemetry").select("catalog_track_id, baseline_at, last_captured_at, last_plays_28d, growth_abs, growth_pct, snapshots_count"),
  ]);
  if (tracksRes.error) throw tracksRes.error;
  if (statsRes.error) throw statsRes.error;
  if (telRes.error) throw telRes.error;
  const statsMap = new Map<string, DistributionStats>((statsRes.data ?? []).map((s) => [s.catalog_track_id, s]));
  const telMap = new Map<string, Telemetry>((telRes.data ?? []).map((s) => [s.catalog_track_id, s]));
  return (tracksRes.data ?? []).map((t) => ({ ...(t as CatalogTrack), stats: statsMap.get(t.id) ?? null, tel: telMap.get(t.id) ?? null }));
}

const fmt = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("pt-BR") : "—");
const rel = (iso: string | null | undefined) => {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

function CollectBadge({ tel }: { tel: Telemetry | null }) {
  if (!tel || tel.snapshots_count === 0) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-amber-400" title="Sem snapshots ainda"><AlertTriangle className="h-3 w-3" />sem coleta</span>;
  }
  const ageMin = tel.last_captured_at ? (Date.now() - new Date(tel.last_captured_at).getTime()) / 60000 : Infinity;
  const stale = ageMin > 60 * 24; // >24h
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px]", stale ? "text-amber-400" : "text-emerald-400")} title={`Última coleta há ${rel(tel.last_captured_at)}`}>
      {stale ? <Clock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
      {rel(tel.last_captured_at)}
    </span>
  );
}

function StatCell({ stats }: { stats: DistributionStats | null }) {
  if (!stats || stats.placements_total === 0) return <span className="text-xs text-subtle-foreground">—</span>;
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className="text-foreground">{stats.placements_active}</span>
      <span className="text-subtle-foreground">/</span>
      <span className="text-foreground-body">{stats.placements_total}</span>
      {stats.placements_pending > 0 && <span className="text-amber-400" title={`${stats.placements_pending} pendentes`}>•{stats.placements_pending}</span>}
      {stats.placements_failed > 0 && <span className="text-rose-400" title={`${stats.placements_failed} falhas`}>✕{stats.placements_failed}</span>}
    </div>
  );
}

function GrowthCell({ tel }: { tel: Telemetry | null }) {
  if (!tel || tel.growth_abs == null) return <span className="text-xs text-subtle-foreground">—</span>;
  const positive = tel.growth_abs >= 0;
  return (
    <div className="flex flex-col">
      <span className={cn("text-xs font-mono", positive ? "text-emerald-400" : "text-rose-400")}>
        {positive ? "+" : ""}{fmt(tel.growth_abs)}
      </span>
      {tel.growth_pct != null && (
        <span className="text-[10px] text-muted-foreground font-mono">{positive ? "+" : ""}{tel.growth_pct}%</span>
      )}
    </div>
  );
}

export function MusicasTab() {
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortId>("added");
  const qc = useQueryClient();
  const tracksQ = useQuery({ queryKey: ["catalog", "tracks"], queryFn: fetchAll, staleTime: 15_000, refetchInterval: 20_000 });

  useEffect(() => {
    const open = () => setAddOpen(true);
    window.addEventListener("catalogo:add-track", open);
    return () => window.removeEventListener("catalogo:add-track", open);
  }, []);

  const rows = useMemo(() => {
    const all = tracksQ.data ?? [];
    const filtered = all.filter((r) => {
      if (filter === "active") return r.status === "active";
      if (filter === "failed") return (r.stats?.placements_failed ?? 0) > 0;
      if (filter === "no_baseline") return !r.tel?.baseline_at;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "growth") return (b.tel?.growth_abs ?? -Infinity) - (a.tel?.growth_abs ?? -Infinity);
      if (sort === "placements") return (b.stats?.placements_active ?? 0) - (a.stats?.placements_active ?? 0);
      return new Date(b.added_at).getTime() - new Date(a.added_at).getTime();
    });
    return sorted;
  }, [tracksQ.data, filter, sort]);

  const FILTERS: { id: FilterId; label: string }[] = [
    { id: "all", label: "Todas" },
    { id: "active", label: "Ativas" },
    { id: "failed", label: "Com falha" },
    { id: "no_baseline", label: "Sem baseline" },
  ];
  const SORTS: { id: SortId; label: string }[] = [
    { id: "added", label: "Mais recentes" },
    { id: "growth", label: "Maior crescimento" },
    { id: "placements", label: "Mais placements" },
  ];

  return (
    <>
      {/* Filtros + sort — uma única régua compacta, scroll horizontal no mobile */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto scrollbar-none -mx-1 px-1">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? "default" : "outline"}
              className="h-7 rounded-full text-xs px-3 shrink-0"
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortId)}>
          <SelectTrigger className="h-7 rounded-full text-xs px-3 w-auto gap-1.5 shrink-0">
            <ArrowUpDown className="h-3 w-3" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-xs">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>


      {tracksQ.isLoading ? (
        <div className="border border-border rounded-2xl overflow-hidden bg-card p-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="border border-border rounded-2xl bg-card p-12 flex flex-col items-center justify-center text-center gap-3">
          <Music2 className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {filter === "all" ? 'Nenhuma música no catálogo. Clique em "Adicionar música" pra começar.' : "Nenhuma música com esse filtro."}
          </p>
        </div>
      ) : (
        <>
          {/* MOBILE — editorial denso */}
          {/* Grid unificado — mesmo padrão de Curador/Cliente */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {rows.map((t) => {
              const active = t.stats?.placements_active ?? 0;
              const total = t.stats?.placements_total ?? 0;
              const pending = t.stats?.placements_pending ?? 0;
              const failed = t.stats?.placements_failed ?? 0;
              const pct = total > 0 ? Math.min(100, Math.round((active / total) * 100)) : 0;
              const hasBaseline = !!t.tel?.baseline_at;
              const noCollect = !t.tel || t.tel.snapshots_count === 0;
              const collectAge = t.tel?.last_captured_at ? (Date.now() - new Date(t.tel.last_captured_at).getTime()) / 60000 : Infinity;
              const stale = collectAge > 60 * 24;
              const growth = t.tel?.growth_abs;
              const growthPct = t.tel?.growth_pct;
              const last28 = t.tel?.last_plays_28d;

              const status: { variant: StatusVariant; label: string } =
                failed > 0 ? { variant: "danger", label: `${failed} falha${failed > 1 ? "s" : ""}` }
                : noCollect ? { variant: "warning", label: "Sem coleta" }
                : stale ? { variant: "warning", label: "Coleta atrasada" }
                : !hasBaseline ? { variant: "warning", label: "Sem baseline" }
                : t.status === "active" ? { variant: "success", label: "Ativa" }
                : { variant: "neutral", label: t.status };

              return (
                <div
                  key={t.id}
                  onClick={() => navigate(`/catalogo/musica/${t.id}`)}
                  style={{ contentVisibility: "auto", containIntrinsicSize: "320px 220px" }}
                  className={cn(
                    "group relative rounded-2xl border border-border/50 bg-card transition-colors cursor-pointer",
                    "border-l-2 border-l-domain-playlists/60",
                    "hover:border-foreground/20 hover:border-l-domain-playlists hover:bg-[hsl(var(--elevated))]",
                  )}
                >
                  {/* Linha 1 — identidade */}
                  <div className="flex items-center gap-2 px-3 pt-3 pb-2 min-w-0">
                    {t.cover_url ? (
                      <img src={t.cover_url} alt="" loading="lazy" className="h-8 w-8 rounded-md object-cover shrink-0 ring-1 ring-border/50" />
                    ) : (
                      <div className="h-8 w-8 rounded-md bg-domain-playlists/15 border border-domain-playlists/25 flex items-center justify-center shrink-0">
                        <Music2 className="h-3.5 w-3.5 text-domain-playlists" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-semibold text-foreground truncate leading-tight">
                        {t.track_name}
                      </div>
                      <div className="text-[10.5px] text-muted-foreground truncate mt-0.5">
                        <span className="truncate">{t.artist_name}</span>
                        {t.isrc && (<><span className="mx-1 opacity-50">·</span><span className="tabular-nums">{t.isrc}</span></>)}
                      </div>
                    </div>
                    <StatusDot variant={status.variant} label={status.label} className="shrink-0" />
                    <button
                      type="button"
                      title="Criar campanha com essa música"
                      onClick={(e) => { e.stopPropagation(); navigate(`/campanhas?novaCampanha=${t.spotify_track_id}`); }}
                      className="h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center shrink-0 transition-colors"
                      aria-label="Criar campanha"
                    >
                      <Target className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mx-3 border-t border-border/40" />

                  {/* Linha 2 — métricas + progresso */}
                  <div className="px-3 py-2.5 space-y-2 min-w-0">
                    <div className="grid grid-cols-2 gap-2">
                      <MetricCell
                        label="Ativas"
                        value={<>{active}<span className="text-muted-foreground font-normal text-[11px]"> / {total}</span></>}
                        size="sm"
                      />
                      <MetricCell
                        label="28 dias"
                        value={last28 != null ? fmt(last28) : "—"}
                        size="sm"
                      />
                    </div>
                    {total > 0 && (
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center justify-between text-[9.5px] text-muted-foreground">
                          <span className="uppercase tracking-[0.12em] font-medium">Distribuição</span>
                          <span className="tabular-nums font-semibold text-foreground">{pct}%</span>
                        </div>
                        <Progress value={pct} className="h-1 rounded-full" />
                        {pending > 0 && (
                          <div className="text-[9.5px] text-amber-400 tabular-nums">
                            {pending} pendente{pending > 1 ? "s" : ""}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground pt-1 border-t border-border/30">
                      {growth != null && (
                        <span className={cn("inline-flex items-center gap-0.5 tabular-nums font-medium", growth >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {growth >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                          {growth >= 0 ? "+" : ""}{fmt(growth)}
                          {growthPct != null && <span className="opacity-80">({growth >= 0 ? "+" : ""}{growthPct}%)</span>}
                        </span>
                      )}
                      {t.tel?.last_captured_at && (
                        <span className="inline-flex items-center gap-0.5 whitespace-nowrap ml-auto">
                          <Clock className="h-2.5 w-2.5" />
                          {rel(t.tel.last_captured_at)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

        </>
      )}


      <AddCatalogTrackDialog open={addOpen} onOpenChange={setAddOpen} onDistributed={() => { qc.invalidateQueries({ queryKey: ["catalog"] }); }} />
    </>
  );
}
