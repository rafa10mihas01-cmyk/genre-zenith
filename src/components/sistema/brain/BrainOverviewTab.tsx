// BrainOverviewTab — KPIs vivos + sparklines + delta % por janela.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MetricCard } from "./shared/MetricCard";
import { WindowSelector, TimeWindow, windowToDays } from "./shared/WindowSelector";
import { Skeleton } from "@/components/ui/skeleton";

type Snap = {
  captured_at: string;
  knowledge_score: number | null;
  avg_leadership_score: number | null;
  recent_drifts_7d: number | null;
  freshness_avg: number | null;
  cluster_strength_avg: number | null;
  tokens_total: number | null;
  active_leaders: number | null;
};

function aggregate(snaps: Snap[], key: keyof Snap): Array<{ t: string; v: number }> {
  // agrupa por dia (média)
  const map = new Map<string, { sum: number; n: number }>();
  snaps.forEach((s) => {
    const day = s.captured_at.slice(0, 10);
    const v = Number(s[key]) || 0;
    const cur = map.get(day) ?? { sum: 0, n: 0 };
    cur.sum += v; cur.n += 1; map.set(day, cur);
  });
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, { sum, n }]) => ({ t, v: sum / n }));
}

function delta(series: Array<{ t: string; v: number }>): number | null {
  if (series.length < 2) return null;
  const a = series[0].v, b = series[series.length - 1].v;
  if (!a) return null;
  return ((b - a) / a) * 100;
}

export function BrainOverviewTab() {
  const [window, setWindow] = useState<TimeWindow>("30d");
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - windowToDays(window) * 86400000).toISOString();
      const { data } = await supabase
        .from("genre_brain_history")
        .select("captured_at, knowledge_score, avg_leadership_score, recent_drifts_7d, freshness_avg, cluster_strength_avg, tokens_total, active_leaders")
        .gte("captured_at", since)
        .order("captured_at", { ascending: true });
      setSnaps((data ?? []) as Snap[]);
      setLoading(false);
    })();
  }, [window]);

  const series = useMemo(() => ({
    knowledge: aggregate(snaps, "knowledge_score"),
    leadership: aggregate(snaps, "avg_leadership_score"),
    drift: aggregate(snaps, "recent_drifts_7d"),
    freshness: aggregate(snaps, "freshness_avg"),
    cluster: aggregate(snaps, "cluster_strength_avg"),
    lexical: aggregate(snaps, "tokens_total"),
    leaders: aggregate(snaps, "active_leaders"),
  }), [snaps]);

  const last = (s: Array<{ t: string; v: number }>) => s.length ? s[s.length - 1].v : 0;
  const fmt = (n: number, d = 2) => isFinite(n) ? n.toFixed(d) : "—";
  const fmtInt = (n: number) => isFinite(n) ? Math.round(n).toString() : "—";

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Radar do cérebro</h3>
          <p className="text-[12px] text-muted-foreground">7 métricas vivas + tendência da janela</p>
        </div>
        <WindowSelector value={window} onChange={setWindow} />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[120px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard label="Knowledge score" value={fmt(last(series.knowledge))} series={series.knowledge} delta={delta(series.knowledge)} accent="growth" hint="média ponderada do cérebro" />
          <MetricCard label="Leadership médio" value={fmt(last(series.leadership))} series={series.leadership} delta={delta(series.leadership)} accent="growth" hint="playlists líderes" />
          <MetricCard label="Atividade de drift" value={fmtInt(last(series.drift))} series={series.drift} delta={delta(series.drift)} accent="drift" hint="reclassificações 7d" />
          <MetricCard label="Freshness" value={fmt(last(series.freshness))} series={series.freshness} delta={delta(series.freshness)} accent="growth" hint="quão vivo está o catálogo" />
          <MetricCard label="Força dos clusters" value={fmt(last(series.cluster))} series={series.cluster} delta={delta(series.cluster)} accent="default" hint="coesão dos agrupamentos" />
          <MetricCard label="Crescimento léxico" value={fmtInt(last(series.lexical))} series={series.lexical} delta={delta(series.lexical)} accent="default" hint="termos aprendidos" />
          <MetricCard label="Líderes ativos" value={fmtInt(last(series.leaders))} series={series.leaders} delta={delta(series.leaders)} accent="default" hint="playlists referência" />
          <MetricCard label="Pontos de captura" value={fmtInt(snaps.length)} hint={`janela: ${window}`} />
        </div>
      )}

      {!loading && snaps.length < 7 && (
        <div className="nx-card p-3 text-[12px] text-muted-foreground">
          Histórico em construção — métricas temporais ficam ricas após 7 dias de captura.
        </div>
      )}
    </section>
  );
}
