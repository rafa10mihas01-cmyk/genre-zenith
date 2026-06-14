// MusicasTab — lista de faixas do catálogo com métricas de distribuição + telemetria.
// Linha clicável → /catalogo/musica/:id. KPIs vivem no pai (Catalogo.tsx).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Music2, CheckCircle2, AlertTriangle, Clock, ChevronRight, ArrowUpDown } from "lucide-react";
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
          {/* MOBILE — cards premium */}
          <div className="md:hidden space-y-2">
            {rows.map((t) => {
              const active = t.stats?.placements_active ?? 0;
              const total = t.stats?.placements_total ?? 0;
              const failed = t.stats?.placements_failed ?? 0;
              return (
                <button
                  key={t.id}
                  onClick={() => navigate(`/catalogo/musica/${t.id}`)}
                  className="w-full text-left bg-card border border-border rounded-2xl p-3 active:scale-[0.99] transition-transform hover:border-border/80"
                >
                  {/* Linha 1 — cover + título + chevron */}
                  <div className="flex items-center gap-3">
                    {t.cover_url ? (
                      <img src={t.cover_url} alt="" className="h-12 w-12 rounded-lg object-cover shrink-0 shadow-sm" loading="lazy" />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center shrink-0"><Music2 className="h-5 w-5 text-muted-foreground" /></div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-foreground truncate leading-tight">{t.track_name}</div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{t.artist_name}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-subtle-foreground shrink-0" />
                  </div>

                  {/* Linha 2 — métricas em pills */}
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5 flex flex-col items-start min-w-0">
                      <span className="text-[10px] uppercase tracking-wide text-subtle-foreground">Ativas</span>
                      <span className="font-mono text-sm text-foreground tabular-nums">
                        {active}<span className="text-subtle-foreground"> / {total}</span>
                        {failed > 0 && <span className="text-rose-400 ml-1">✕{failed}</span>}
                      </span>
                    </div>
                    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5 flex flex-col items-start min-w-0">
                      <span className="text-[10px] uppercase tracking-wide text-subtle-foreground">28d</span>
                      <span className="font-mono text-sm text-foreground tabular-nums truncate w-full">{fmt(t.tel?.last_plays_28d)}</span>
                    </div>
                    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5 flex flex-col items-start min-w-0">
                      <span className="text-[10px] uppercase tracking-wide text-subtle-foreground">Coleta</span>
                      <div className="text-sm leading-tight"><CollectBadge tel={t.tel} /></div>
                    </div>
                  </div>

                  {/* Linha 3 — Δ baseline (só quando existe) */}
                  {t.tel?.growth_abs != null && (
                    <div className="mt-2 flex items-center justify-between px-1">
                      <span className="text-[10px] uppercase tracking-wide text-subtle-foreground">Δ baseline</span>
                      <div className="flex items-center gap-2">
                        <span className={cn("text-xs font-mono tabular-nums", t.tel.growth_abs >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {t.tel.growth_abs >= 0 ? "+" : ""}{fmt(t.tel.growth_abs)}
                        </span>
                        {t.tel.growth_pct != null && (
                          <span className={cn("text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded", t.tel.growth_abs >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>
                            {t.tel.growth_abs >= 0 ? "+" : ""}{t.tel.growth_pct}%
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* DESKTOP — tabela */}
          <div className="hidden md:block border border-border rounded-2xl overflow-hidden bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14"></TableHead>
                  <TableHead>Música</TableHead>
                  <TableHead>Artista</TableHead>
                  <TableHead>Distribuição</TableHead>
                  <TableHead className="hidden lg:table-cell">Streams 28d</TableHead>
                  <TableHead className="hidden lg:table-cell">Δ baseline</TableHead>
                  <TableHead>Coleta</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/catalogo/musica/${t.id}`)}>
                    <TableCell>
                      {t.cover_url ? (
                        <img src={t.cover_url} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" />
                      ) : (
                        <div className="h-10 w-10 rounded bg-muted flex items-center justify-center"><Music2 className="h-4 w-4 text-muted-foreground" /></div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{t.track_name}</TableCell>
                    <TableCell className="text-muted-foreground">{t.artist_name}</TableCell>
                    <TableCell><StatCell stats={t.stats} /></TableCell>
                    <TableCell className="hidden lg:table-cell text-xs font-mono">{fmt(t.tel?.last_plays_28d)}</TableCell>
                    <TableCell className="hidden lg:table-cell"><GrowthCell tel={t.tel} /></TableCell>
                    <TableCell><CollectBadge tel={t.tel} /></TableCell>
                    <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <AddCatalogTrackDialog open={addOpen} onOpenChange={setAddOpen} onDistributed={() => { qc.invalidateQueries({ queryKey: ["catalog"] }); }} />
    </>
  );
}
