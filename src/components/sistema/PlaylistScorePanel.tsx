// Wave 2 — Painel debug Playlist Ecosystem Score
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RefreshCw, RotateCw, Search, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type Row = {
  id: string;
  playlist_kind: "curator" | "managed";
  spotify_playlist_id: string;
  playlist_name: string | null;
  curator_name: string | null;
  image_url: string | null;
  followers: number;
  track_count: number;
  total_streams: number;
  streams_7d: number;
  streams_28d: number;
  growth_28d_pct: number | null;
  avg_track_momentum: number | null;
  pct_subindo: number;
  pct_caindo: number;
  pct_saturada: number;
  pct_estavel: number;
  health_class: string;
  efficiency_score: number;
  confidence: number;
  snapshots_used: number;
  last_snapshot_at: string | null;
  calculated_at: string;
};

const HEALTH_COLORS: Record<string, string> = {
  aquecida: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  estavel: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  esfriando: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  saturada: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  subutilizada: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  sem_dados: "bg-zinc-700/30 text-zinc-500 border-zinc-700/40",
};

const FILTERS = ["todos", "aquecida", "estavel", "esfriando", "saturada", "subutilizada", "sem_dados"];

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("pt-BR");
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function PlaylistScorePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [recalcAll, setRecalcAll] = useState(false);
  const [recalcSingle, setRecalcSingle] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("playlist_ecosystem_score")
      .select("*")
      .order("calculated_at", { ascending: false })
      .limit(2000);
    if (error) toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter !== "todos" && r.health_class !== filter) return false;
      if (search) {
        const s = search.toLowerCase();
        const hit =
          (r.playlist_name ?? "").toLowerCase().includes(s) ||
          (r.curator_name ?? "").toLowerCase().includes(s) ||
          r.spotify_playlist_id.toLowerCase().includes(s);
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  const handleRecalcAll = async () => {
    if (!confirm("Recalcular todas as playlists? Pode demorar alguns minutos (processa em lotes).")) return;
    setRecalcAll(true);
    let offset = 0;
    const limit = 20;
    let totalOk = 0, totalFailed = 0, grandTotal = 0;
    try {
      while (true) {
        const { data, error } = await supabase.functions.invoke("calculate-playlist-ecosystem-score", {
          body: { mode: "batch", offset, limit },
        });
        if (error) throw error;
        totalOk += data?.ok ?? 0;
        totalFailed += data?.failed ?? 0;
        grandTotal = data?.total ?? grandTotal;
        toast({
          title: `Lote ${offset}–${data?.processed_to ?? offset}`,
          description: `${totalOk}/${grandTotal} ok · ${totalFailed} falhas`,
        });
        if (!data?.has_more) break;
        offset = data.processed_to;
      }
      toast({ title: "Recálculo completo", description: `${totalOk} ok · ${totalFailed} falhas (${grandTotal} total)` });
      await load();
    } catch (e: unknown) {
      toast({ title: "Erro no lote", description: errorMessage(e), variant: "destructive" });
    } finally {
      setRecalcAll(false);
    }
  };

  const handleRecalcSingle = async (r: Row) => {
    setRecalcSingle(r.spotify_playlist_id);
    try {
      const { error } = await supabase.functions.invoke("calculate-playlist-ecosystem-score", {
        body: { mode: "single", spotify_playlist_id: r.spotify_playlist_id, playlist_kind: r.playlist_kind },
      });
      if (error) throw error;
      toast({ title: "Recalculado" });
      await load();
    } catch (e: unknown) {
      toast({ title: "Erro", description: errorMessage(e), variant: "destructive" });
    } finally {
      setRecalcSingle(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.health_class] = (c[r.health_class] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-4 pt-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-sm text-muted-foreground">Total de playlists analisadas</div>
            <div className="text-2xl font-semibold">{rows.length.toLocaleString("pt-BR")}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-2", loading && "animate-spin")} />
              Atualizar
            </Button>
            <Button size="sm" onClick={handleRecalcAll} disabled={recalcAll}>
              <RotateCw className={cn("h-3.5 w-3.5 mr-2", recalcAll && "animate-spin")} />
              {recalcAll ? "Recalculando…" : "Recalcular tudo"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por playlist, curador ou ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-2.5 h-7 text-xs rounded-md border transition-colors",
                  filter === f
                    ? "bg-primary/15 text-primary border-primary/40"
                    : "bg-transparent text-muted-foreground border-border hover:text-foreground",
                )}
              >
                {f} {f !== "todos" && counts[f] ? `(${counts[f]})` : ""}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card text-muted-foreground text-xs uppercase tracking-wider shadow-[0_1px_0_hsl(var(--border))]">
              <tr>
                <th className="w-8" />
                <th className="text-left px-3 py-3 font-medium">Playlist</th>
                <th className="text-left px-3 py-3 font-medium">Saúde</th>
                <th className="text-right px-3 py-3 font-medium">Faixas</th>
                <th className="text-right px-3 py-3 font-medium">Streams</th>
                <th className="text-right px-3 py-3 font-medium">28d %</th>
                <th className="text-right px-3 py-3 font-medium">↑ %</th>
                <th className="text-right px-3 py-3 font-medium">↓ %</th>
                <th className="text-right px-3 py-3 font-medium">Conf.</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="text-center py-10 text-muted-foreground">Carregando…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} className="text-center py-10 text-muted-foreground">
                  Nenhuma playlist. Rode "Recalcular tudo" para popular.
                </td></tr>
              )}
              {filtered.map((r) => {
                const isOpen = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className="border-t border-border hover:bg-muted/20">
                      <td className="px-2 py-2 align-top">
                        <button
                          onClick={() => setExpanded(isOpen ? null : r.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium leading-tight">
                          {r.playlist_name ?? <span className="text-muted-foreground">—</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {r.curator_name ?? "—"} · {r.playlist_kind}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={cn("border text-xs", HEALTH_COLORS[r.health_class])}>
                          {r.health_class}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.track_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.total_streams)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.growth_28d_pct)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.pct_subindo.toFixed(0)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.pct_caindo.toFixed(0)}%</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(r.confidence * 100).toFixed(0)}%</td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleRecalcSingle(r)}
                          disabled={recalcSingle === r.spotify_playlist_id}
                          title="Recalcular esta playlist"
                        >
                          <RotateCw className={cn("h-3 w-3", recalcSingle === r.spotify_playlist_id && "animate-spin")} />
                        </Button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/10 border-t border-border">
                        <td />
                        <td colSpan={9} className="px-3 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <Field label="Playlist ID" value={r.spotify_playlist_id} mono />
                            <Field label="Followers" value={fmtNum(r.followers)} />
                            <Field label="Streams 7d" value={fmtNum(r.streams_7d)} />
                            <Field label="Streams 28d" value={fmtNum(r.streams_28d)} />
                            <Field label="% Saturada" value={`${r.pct_saturada.toFixed(0)}%`} />
                            <Field label="% Estável" value={`${r.pct_estavel.toFixed(0)}%`} />
                            <Field label="Momentum médio" value={r.avg_track_momentum?.toFixed(2) ?? "—"} />
                            <Field label="Eficiência" value={(r.efficiency_score * 100).toFixed(0) + "%"} />
                            <Field label="Snapshots usados" value={String(r.snapshots_used)} />
                            <Field label="Último snapshot" value={r.last_snapshot_at ? new Date(r.last_snapshot_at).toLocaleString("pt-BR") : "—"} />
                            <Field label="Calculado em" value={new Date(r.calculated_at).toLocaleString("pt-BR")} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > 0 && (
          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {filtered.length.toLocaleString("pt-BR")} playlists na lista
          </div>
        )}
      </Card>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">{label}</div>
      <div className={cn("text-foreground", mono && "font-mono text-[11px] break-all")}>{value}</div>
    </div>
  );
}
