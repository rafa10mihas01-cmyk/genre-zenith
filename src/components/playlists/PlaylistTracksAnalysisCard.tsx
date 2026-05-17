import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Music2,
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  AlertTriangle,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "keep" | "remove" | "promote" | "demote";

type TrackRow = {
  spotify_track_id: string;
  track_name: string | null;
  artist_name: string | null;
  position: number;
  status: Status;
  reasons: string[];
  recurrence_in_genre: number;
  streams_28d: number | null;
  growth_28d_pct: number | null;
  saturation_index: number | null;
  momentum: string | null;
  confidence: number | null;
};

type Summary = {
  total?: number;
  keep?: number;
  remove?: number;
  promote?: number;
  demote?: number;
  saturated?: number;
  saturated_pct?: number;
  no_data?: number;
  missing_artists?: { artist: string; count: number }[];
};

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat("pt-BR").format(n);
}

const STATUS_META: Record<Status, { label: string; cls: string; icon: any }> = {
  keep: { label: "Manter", cls: "border-primary/30 text-primary bg-primary/5", icon: CheckCircle2 },
  remove: { label: "Remover", cls: "border-destructive/40 text-destructive bg-destructive/5", icon: TrendingDown },
  promote: { label: "Promover", cls: "border-warning/40 text-warning bg-warning/5", icon: ArrowUp },
  demote: { label: "Rebaixar", cls: "border-muted-foreground/30 text-muted-foreground bg-muted/20", icon: ArrowDown },
};

export function PlaylistTracksAnalysisCard({ managedId }: { managedId: string }) {
  const [analysis, setAnalysis] = useState<TrackRow[]>([]);
  const [summary, setSummary] = useState<Summary>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Status>("all");

  useEffect(() => {
    if (!managedId) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("playlist_diagnoses")
        .select("tracks_analysis, tracks_summary")
        .eq("playlist_id", managedId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (active) {
        setAnalysis(Array.isArray(data?.tracks_analysis) ? (data!.tracks_analysis as any) : []);
        setSummary((data?.tracks_summary as any) ?? {});
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [managedId]);

  const visible = useMemo(() => {
    if (filter === "all") return analysis;
    return analysis.filter((t) => t.status === filter);
  }, [analysis, filter]);

  if (loading) {
    return (
      <Card className="p-5 h-32 grid place-items-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!analysis.length) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        Sem análise faixa-a-faixa ainda. Clique em <span className="text-foreground font-medium">Diagnosticar agora</span> para gerar.
      </Card>
    );
  }

  const counts = {
    total: summary.total ?? analysis.length,
    keep: summary.keep ?? analysis.filter((x) => x.status === "keep").length,
    remove: summary.remove ?? analysis.filter((x) => x.status === "remove").length,
    promote: summary.promote ?? analysis.filter((x) => x.status === "promote").length,
    demote: summary.demote ?? analysis.filter((x) => x.status === "demote").length,
  };
  const missingArtists = summary.missing_artists ?? [];

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Music2 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Análise faixa-a-faixa</h2>
          <span className="text-xs text-muted-foreground ml-1">{counts.total} faixas</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          {[
            { key: "keep" as Status, n: counts.keep, label: "Manter" },
            { key: "remove" as Status, n: counts.remove, label: "Remover" },
            { key: "promote" as Status, n: counts.promote, label: "Promover" },
            { key: "demote" as Status, n: counts.demote, label: "Rebaixar" },
          ].map((kpi) => {
            const meta = STATUS_META[kpi.key];
            return (
              <div key={kpi.key} className={cn("rounded-lg border p-3", meta.cls)}>
                <div className="text-[10px] uppercase tracking-wider opacity-80">{kpi.label}</div>
                <div className="text-xl font-semibold tabular-nums">{kpi.n}</div>
              </div>
            );
          })}
          <div className="rounded-lg border border-border p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Saturadas</div>
            <div className="text-xl font-semibold tabular-nums">
              {summary.saturated ?? 0}
              {summary.saturated_pct != null && (
                <span className="text-xs text-muted-foreground ml-1">({summary.saturated_pct}%)</span>
              )}
            </div>
          </div>
        </div>

        {summary.no_data != null && summary.no_data > 0 && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-md p-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {summary.no_data} faixas ainda sem dados de performance — o ecosystem score precisa de mais snapshots pra classificar com confiança.
            </span>
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
            className="h-7 text-xs"
          >
            Todas ({counts.total})
          </Button>
          {(["remove", "promote", "demote", "keep"] as Status[]).map((k) => {
            const meta = STATUS_META[k];
            const n = counts[k];
            return (
              <Button
                key={k}
                size="sm"
                variant={filter === k ? "default" : "outline"}
                onClick={() => setFilter(k)}
                disabled={n === 0}
                className="h-7 text-xs"
              >
                {meta.label} ({n})
              </Button>
            );
          })}
        </div>
      </Card>

      {/* Artistas faltando */}
      {missingArtists.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-warning" />
            <h2 className="text-sm font-semibold">Artistas faltando no nicho</h2>
            <span className="text-xs text-muted-foreground">{missingArtists.length}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Estão presentes nas playlists vencedoras do gênero mas não na sua.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missingArtists.slice(0, 12).map((a) => (
              <Badge key={a.artist} variant="outline" className="text-[11px]">
                {a.artist}
                <span className="ml-1.5 text-muted-foreground tabular-nums">×{a.count}</span>
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* Tabela operacional */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">
            {filter === "all" ? "Todas as faixas" : STATUS_META[filter].label}
          </h2>
          <span className="text-xs text-muted-foreground">{visible.length}</span>
        </div>
        {visible.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma faixa neste filtro.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left font-medium py-2 pr-2 w-10">#</th>
                  <th className="text-left font-medium py-2 pr-2">Faixa</th>
                  <th className="text-left font-medium py-2 pr-2">Status</th>
                  <th className="text-left font-medium py-2 pr-2">Motivo</th>
                  <th className="text-right font-medium py-2 pr-2">Streams 28d</th>
                  <th className="text-right font-medium py-2 pr-2">Crescimento</th>
                  <th className="text-right font-medium py-2">No nicho</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const meta = STATUS_META[t.status];
                  const Icon = meta.icon;
                  const growth = t.growth_28d_pct;
                  return (
                    <tr key={t.spotify_track_id} className="border-b border-border/40 last:border-0 align-top">
                      <td className="py-2 pr-2 text-muted-foreground tabular-nums">{t.position + 1}</td>
                      <td className="py-2 pr-2 min-w-[180px]">
                        <div className="font-medium text-foreground/90 truncate max-w-[260px]">{t.track_name ?? "—"}</div>
                        <div className="text-muted-foreground truncate max-w-[260px]">{t.artist_name ?? "—"}</div>
                      </td>
                      <td className="py-2 pr-2">
                        <Badge variant="outline" className={cn("text-[10px] gap-1", meta.cls)}>
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground max-w-[300px]">
                        {(t.reasons ?? []).join(" · ") || "—"}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{fmtNum(t.streams_28d)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {growth == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex items-center gap-0.5",
                              growth > 0 ? "text-primary" : growth < 0 ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {growth > 0 ? <TrendingUp className="h-3 w-3" /> : growth < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                            {growth > 0 ? "+" : ""}
                            {growth.toFixed(0)}%
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {t.recurrence_in_genre > 0 ? (
                          <span className="text-foreground">{t.recurrence_in_genre}×</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
