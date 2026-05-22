// MarketHeatmapTab — mapa de temperatura por subgênero.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { WindowSelector, TimeWindow, windowToDays } from "./shared/WindowSelector";

type Row = {
  genre_id: string; slug: string;
  captured_at: string;
  knowledge_score: number | null;
  active_leaders: number | null;
  recent_drifts_7d: number | null;
  freshness_avg: number | null;
};

type Cell = {
  slug: string;
  growth: number;   // delta % do knowledge
  activity: number; // leaders + drift
  saturation: number; // 1 - growth potential
  drift: number;
  freshness: number;
};

function tempClass(growth: number, freshness: number): string {
  // crescendo e vivo → quente; caindo e parado → frio
  const score = growth * 0.7 + (freshness - 0.5) * 60;
  if (score > 15) return "bg-emerald-500/25 border-emerald-500/40";
  if (score > 5) return "bg-emerald-500/10 border-emerald-500/20";
  if (score < -15) return "bg-rose-500/20 border-rose-500/40";
  if (score < -5) return "bg-rose-500/10 border-rose-500/20";
  return "bg-elevated border-border";
}

export function MarketHeatmapTab() {
  const [window, setWindow] = useState<TimeWindow>("30d");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - windowToDays(window) * 86400000).toISOString();
      const { data } = await supabase
        .from("genre_brain_history")
        .select("genre_id, slug, captured_at, knowledge_score, active_leaders, recent_drifts_7d, freshness_avg")
        .gte("captured_at", since)
        .order("captured_at", { ascending: true });
      setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
  }, [window]);

  const cells: Cell[] = useMemo(() => {
    const byGenre = new Map<string, Row[]>();
    rows.forEach((r) => {
      const arr = byGenre.get(r.slug) ?? [];
      arr.push(r); byGenre.set(r.slug, arr);
    });
    return [...byGenre.entries()].map(([slug, arr]) => {
      const first = arr[0], last = arr[arr.length - 1];
      const k0 = Number(first.knowledge_score) || 0;
      const k1 = Number(last.knowledge_score) || 0;
      const growth = k0 > 0 ? ((k1 - k0) / k0) * 100 : 0;
      const drift = Number(last.recent_drifts_7d) || 0;
      const activity = (Number(last.active_leaders) || 0) + drift;
      const freshness = Number(last.freshness_avg) || 0;
      const saturation = k1 > 0.7 && growth < 2 ? 1 : 0;
      return { slug, growth, activity, saturation, drift, freshness };
    }).sort((a, b) => b.activity - a.activity);
  }, [rows]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Heatmap do mercado</h3>
          <p className="text-[12px] text-muted-foreground">nichos crescendo · esfriando · saturados</p>
        </div>
        <WindowSelector value={window} onChange={setWindow} />
      </div>

      {loading ? <Skeleton className="h-64" /> : cells.length === 0 ? (
        <div className="nx-card p-8 text-center text-sm text-muted-foreground">
          Sem dados de histórico suficientes. Os snapshots diários alimentam este mapa.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {cells.map((c) => {
            const sizeClass = c.activity > 20 ? "row-span-2 col-span-2 md:col-span-2" : "";
            return (
              <div key={c.slug} className={cn("rounded-2xl border p-3 transition-colors", tempClass(c.growth, c.freshness), sizeClass)}>
                <p className="text-sm font-semibold truncate">{c.slug}</p>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Crescimento</p>
                    <p className={cn("text-lg font-semibold", c.growth > 0 ? "text-success" : c.growth < 0 ? "text-destructive" : "")}>
                      {c.growth > 0 ? "+" : ""}{c.growth.toFixed(1)}%
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase text-muted-foreground">Atividade</p>
                    <p className="text-sm font-semibold">{Math.round(c.activity)}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                  {c.saturation ? <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">saturado</span> : null}
                  {c.drift > 0 ? <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300">{c.drift} drift</span> : null}
                  <span>fresh {c.freshness.toFixed(2)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
