// Wave 1 — Debug panel for Track Ecosystem Score.
// Read-only table + recalc buttons. Sem ações de recomendação.
import { Fragment, useEffect, useMemo, useState } from "react";
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
  spotify_track_id: string;
  track_name: string | null;
  artist_name: string | null;
  streams_total: number;
  streams_7d: number;
  streams_28d: number;
  growth_7d_pct: number | null;
  growth_28d_pct: number | null;
  acceleration: number | null;
  managed_playlist_count: number;
  curator_playlist_count: number;
  total_playlist_count: number;
  deal_active_count: number;
  saturation_index: number;
  frequency_score: number;
  momentum_class: string;
  confidence: number;
  snapshots_used: number;
  last_snapshot_at: string | null;
  calculated_at: string;
};

const MOMENTUM_COLORS: Record<string, string> = {
  subindo: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  forte: "bg-primary/15 text-primary border-primary/30",
  estavel: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  caindo: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  saturada: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  fraca: "bg-red-500/15 text-red-400 border-red-500/30",
  sem_dados: "bg-zinc-700/30 text-zinc-500 border-zinc-700/40",
};

const FILTERS = ["todos", "subindo", "forte", "estavel", "caindo", "saturada", "fraca", "sem_dados"];

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("pt-BR");
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function EcosystemScorePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [recalcAll, setRecalcAll] = useState(false);
  const [recalcSingle, setRecalcSingle] = useState<string | null>(null);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("track_ecosystem_score")
      .select("*")
      .order("calculated_at", { ascending: false })
      .limit(2000);
    if (error) toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  // load é redefinido a cada render; intencionalmente dispara só no mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter !== "todos" && r.momentum_class !== filter) return false;
      if (search) {
        const s = search.toLowerCase();
        const hit =
          (r.track_name ?? "").toLowerCase().includes(s) ||
          (r.artist_name ?? "").toLowerCase().includes(s) ||
          r.spotify_track_id.toLowerCase().includes(s);
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  const handleRecalcAll = async () => {
    if (!confirm("Recalcular todas as faixas? Pode demorar alguns minutos.")) return;
    setRecalcAll(true);
    try {
      const { data, error } = await supabase.functions.invoke("calculate-track-ecosystem-score", {
        body: { mode: "full" },
      });
      if (error) throw error;
      toast({
        title: "Recálculo completo",
        description: `${data?.ok ?? 0} ok / ${data?.failed ?? 0} falharam (${data?.total ?? 0} total)`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setRecalcAll(false);
    }
  };

  const handleRecalcSingle = async (trackId: string) => {
    setRecalcSingle(trackId);
    try {
      const { error } = await supabase.functions.invoke("calculate-track-ecosystem-score", {
        body: { mode: "single", track_id: trackId },
      });
      if (error) throw error;
      toast({ title: "Faixa recalculada" });
      await load();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setRecalcSingle(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.momentum_class] = (c[r.momentum_class] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-4 pt-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-sm text-muted-foreground">Total de faixas analisadas</div>
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
              placeholder="Buscar por faixa, artista ou track ID…"
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="w-8" />
                <th className="text-left px-3 py-3 font-medium">Faixa</th>
                <th className="text-left px-3 py-3 font-medium">Momentum</th>
                <th className="text-right px-3 py-3 font-medium">Streams</th>
                <th className="text-right px-3 py-3 font-medium">7d %</th>
                <th className="text-right px-3 py-3 font-medium">28d %</th>
                <th className="text-right px-3 py-3 font-medium">Playlists</th>
                <th className="text-right px-3 py-3 font-medium">Deals</th>
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
                  Nenhuma faixa. Rode "Recalcular tudo" para popular.
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
                        <div className="font-medium leading-tight">{r.track_name ?? <span className="text-muted-foreground">—</span>}</div>
                        <div className="text-xs text-muted-foreground">{r.artist_name ?? "—"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={cn("border text-xs", MOMENTUM_COLORS[r.momentum_class])}>
                          {r.momentum_class}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.streams_total)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.growth_7d_pct)}</td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        title={r.growth_28d_pct == null ? "Histórico insuficiente (precisa de 28+ dias de snapshots)" : undefined}
                      >
                        {fmtPct(r.growth_28d_pct)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.total_playlist_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.deal_active_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(r.confidence * 100).toFixed(0)}%</td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleRecalcSingle(r.spotify_track_id)}
                          disabled={recalcSingle === r.spotify_track_id}
                          title="Recalcular esta faixa"
                        >
                          <RotateCw className={cn("h-3 w-3", recalcSingle === r.spotify_track_id && "animate-spin")} />
                        </Button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/10 border-t border-border">
                        <td />
                        <td colSpan={9} className="px-3 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <Field label="Track ID" value={r.spotify_track_id} mono />
                            <Field label="Streams 7d" value={fmtNum(r.streams_7d)} />
                            <Field label="Streams 28d" value={fmtNum(r.streams_28d)} />
                            <Field label="Aceleração" value={fmtPct(r.acceleration)} />
                            <Field label="Curator playlists" value={String(r.curator_playlist_count)} />
                            <Field label="Managed playlists" value={String(r.managed_playlist_count)} />
                            <Field label="Saturação" value={(r.saturation_index * 100).toFixed(0) + "%"} />
                            <Field label="Frequência" value={(r.frequency_score * 100).toFixed(0) + "%"} />
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
