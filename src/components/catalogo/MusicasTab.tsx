// MusicasTab — lista de faixas do catálogo com métricas de distribuição + telemetria.
// Linha clicável → /catalogo/musica/:id. KPIs vivem no pai (Catalogo.tsx).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Music2, CheckCircle2, AlertTriangle, Clock, ChevronRight, ArrowUpDown, Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  const statsMap = new Map<string, DistributionStats>((statsRes.data ?? []).map((s: any) => [s.catalog_track_id, s]));
  const telMap = new Map<string, Telemetry>((telRes.data ?? []).map((s: any) => [s.catalog_track_id, s]));
  return (tracksRes.data ?? []).map((t: any) => ({ ...(t as CatalogTrack), stats: statsMap.get(t.id) ?? null, tel: telMap.get(t.id) ?? null }));
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
          <div className="md:hidden space-y-2.5">
            {rows.map((t) => {
              const active = t.stats?.placements_active ?? 0;
              const total = t.stats?.placements_total ?? 0;
              const failed = t.stats?.placements_failed ?? 0;
              const has28d = t.tel?.last_plays_28d != null;
              const hasBaseline = t.tel?.growth_abs != null;
              const collectAge = t.tel?.last_captured_at ? (Date.now() - new Date(t.tel.last_captured_at).getTime()) / 60000 : Infinity;
              const stale = collectAge > 60 * 24;
              const noCollect = !t.tel || t.tel.snapshots_count === 0;
              return (
                <div key={t.id}>
                <button
                  onClick={() => navigate(`/catalogo/musica/${t.id}`)}
                  className="w-full text-left bg-card border border-border rounded-xl p-4 active:scale-[0.99] transition-all hover:bg-[#212121] hover:border-[hsl(0,0%,24%)] group"
                >
                  {/* Cover + título + chevron */}
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      {t.cover_url ? (
                        <img src={t.cover_url} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-white/10 shadow-lg" loading="lazy" />
                      ) : (
                        <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center ring-1 ring-white/10"><Music2 className="h-6 w-6 text-muted-foreground" /></div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent rounded-lg pointer-events-none" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {t.tel && t.tel.snapshots_count > 0 && (
                          <span
                            className={cn(
                              "inline-block w-1.5 h-1.5 rounded-full shrink-0 shadow-[0_0_4px]",
                              t.tel.baseline_at
                                ? "bg-emerald-400 shadow-emerald-400/50"
                                : "bg-amber-400 shadow-amber-400/50"
                            )}
                            title={t.tel.baseline_at ? "Baseline coletada" : "Em coleta de baseline"}
                          />
                        )}
                        <div className="font-semibold text-[15px] text-foreground truncate tracking-tight group-hover:text-[#1DB954] transition-colors">{t.track_name}</div>
                      </div>
                      <div className="text-sm text-muted-foreground truncate mt-0.5">{t.artist_name}</div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-[hsl(0,0%,40%)] shrink-0 group-hover:translate-x-0.5 transition-transform" />
                  </div>

                  {/* Métricas grid 3 colunas */}
                  <div className="grid grid-cols-3 gap-1 pt-4">
                    {/* Ativas */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-[hsl(0,0%,45%)]">Ativas</span>
                      <div className="flex flex-col leading-tight">
                        <div className="flex items-baseline gap-1">
                          <span className="text-[17px] font-bold tabular-nums text-foreground">{active}</span>
                          <span className="text-[11px] font-medium tabular-nums text-[hsl(0,0%,40%)]">/ {total}</span>
                        </div>
                        {failed > 0 && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <div className="w-1 h-1 rounded-full bg-rose-500 shadow-[0_0_4px_rgba(239,68,68,0.5)]" />
                            <span className="text-[10px] font-bold tabular-nums tracking-tight italic text-rose-400">{failed} Falhas</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 28 Dias */}
                    <div className="flex flex-col gap-1 border-l border-[hsl(0,0%,12%)] pl-3">
                      <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-[hsl(0,0%,45%)]">28 Dias</span>
                      <div className="flex flex-col leading-tight">
                        {has28d ? (
                          <span className="text-[17px] font-bold tabular-nums text-foreground">{fmt(t.tel!.last_plays_28d)}</span>
                        ) : (
                          <>
                            <span className="text-[17px] font-medium tabular-nums text-[hsl(0,0%,30%)]">—</span>
                            <span className="text-[10px] font-medium uppercase mt-0.5 text-[hsl(0,0%,25%)]">Sem dados</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Coleta */}
                    $0
            })}
          </div>

          {/* DESKTOP — grid de cards (mesmo padrão de Campanhas) */}
          <div className="hidden md:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
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
              const collectTone = noCollect ? "amber" : stale ? "amber" : "primary";
              const collectLabel = noCollect ? "Sem coleta" : stale ? `Coleta ${rel(t.tel!.last_captured_at)}` : `Coleta ${rel(t.tel!.last_captured_at)}`;
              const growth = t.tel?.growth_abs;
              const growthPct = t.tel?.growth_pct;

              return (
                <div key={t.id} className="relative">
                <button
                  onClick={() => navigate(`/catalogo/musica/${t.id}`)}
                  className="w-full group text-left rounded-2xl border border-border/50 border-l-2 border-l-domain-curators/60 bg-card hover:bg-[hsl(var(--elevated))] hover:border-foreground/20 hover:border-l-domain-curators transition-colors flex flex-col h-full"
                >
                  {/* Linha 1 — identidade */}
                  <div className="flex items-start gap-3 px-4 pt-3.5 pb-2.5 min-w-0">
                    {t.cover_url ? (
                      <img src={t.cover_url} alt="" loading="lazy" className="h-10 w-10 rounded-md object-cover shrink-0" />
                    ) : (
                      <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <Music2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2 min-w-0">
                        <div className="min-w-0 flex-1">
                          <div className="text-[14px] font-semibold text-foreground truncate leading-tight">
                            {t.track_name}
                          </div>
                          <div className="text-[11.5px] text-muted-foreground truncate mt-0.5">
                            {t.artist_name}
                          </div>
                        </div>
                        <div className="shrink-0 mt-0.5 flex items-center gap-1.5">
                          <span
                            className={cn(
                              "inline-block w-1.5 h-1.5 rounded-full",
                              t.status === "active" ? "bg-emerald-400" : "bg-muted-foreground/50",
                            )}
                          />
                          <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                            {t.status === "active" ? "Ativa" : t.status}
                          </span>
                        </div>
                      </div>
                      {/* Chips */}
                      <div className="flex items-center gap-1.5 flex-wrap mt-2">
                        {hasBaseline ? (
                          <span className="text-[10px] uppercase tracking-wider rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary">
                            Baseline ok
                          </span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wider rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-500">
                            Sem baseline
                          </span>
                        )}
                        <span
                          className={cn(
                            "text-[10px] uppercase tracking-wider rounded border px-1.5 py-0.5",
                            collectTone === "primary"
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-500",
                          )}
                        >
                          {collectLabel}
                        </span>
                        {failed > 0 && (
                          <span className="text-[10px] uppercase tracking-wider rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-rose-400">
                            {failed} falha{failed > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Divisor sutil */}
                  <div className="mx-4 border-t border-border/40" />

                  {/* Linha 2 — métricas + progresso + Δ baseline */}
                  <div className="flex flex-col gap-3 px-4 py-3 min-w-0 mt-auto">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium mb-0.5">Placements</div>
                        <div className="text-[14px] font-semibold tabular-nums">
                          {active}
                          <span className="text-muted-foreground font-normal"> / {total}</span>
                          {pending > 0 && (
                            <span className="ml-1.5 text-[11px] text-amber-400">·{pending}</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium mb-0.5">Streams 28d</div>
                        <div className="text-[14px] font-semibold tabular-nums">{fmt(t.tel?.last_plays_28d)}</div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
                        <span className="uppercase tracking-[0.12em] font-medium">Distribuição</span>
                        <span className="tabular-nums font-semibold text-foreground">{pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>

                    {growth != null && (
                      <div className="rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 flex items-center justify-between gap-2">
                        <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground font-medium">Δ baseline</span>
                        <div className="flex items-center gap-2">
                          <span className={cn("text-[12px] font-mono tabular-nums font-semibold", growth >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {growth >= 0 ? "+" : ""}{fmt(growth)}
                          </span>
                          {growthPct != null && (
                            <span className={cn("text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded font-medium", growth >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>
                              {growth >= 0 ? "+" : ""}{growthPct}%
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  title="Criar campanha com essa música"
                  onClick={(e) => { e.stopPropagation(); navigate(`/campanhas?novaCampanha=${t.spotify_track_id}`); }}
                  className="absolute bottom-3 right-3 h-7 px-2.5 rounded-full bg-primary/15 text-primary border border-primary/30 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider hover:bg-primary/25 transition-colors shadow-sm"
                  aria-label="Criar campanha"
                >
                  <Target className="h-3 w-3" />
                  Campanha
                </button>
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
