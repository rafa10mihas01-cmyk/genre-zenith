// LeadershipEvolutionTab — evolução do leadership_score por playlist.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { WindowSelector, TimeWindow, windowToDays } from "./shared/WindowSelector";
import { TrendBadge } from "./shared/TrendBadge";

type Hist = { playlist_id: string; leadership_score: number | null; captured_at: string };

const SERIES_COLORS = [
  "hsl(var(--primary))",
  "hsl(258 60% 70%)",
  "hsl(40 90% 60%)",
  "hsl(0 70% 65%)",
  "hsl(160 60% 55%)",
  "hsl(200 70% 60%)",
  "hsl(320 60% 65%)",
  "hsl(50 80% 60%)",
];

export function LeadershipEvolutionTab() {
  const [window, setWindow] = useState<TimeWindow>("30d");
  const [hist, setHist] = useState<Hist[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - windowToDays(window) * 86400000).toISOString();
      const { data } = await supabase
        .from("playlist_leadership_history")
        .select("playlist_id, leadership_score, captured_at")
        .gte("captured_at", since)
        .order("captured_at", { ascending: true });
      const list = (data ?? []) as Hist[];
      setHist(list);

      const ids = [...new Set(list.map(r => r.playlist_id))];
      if (ids.length) {
        const { data: pls } = await supabase.from("playlists").select("id, name").in("id", ids.slice(0, 200));
        setNames(new Map((pls ?? []).map((p) => [p.id, p.name])));
      }
      setLoading(false);
    })();
  }, [window]);

  // top 8 playlists por leadership atual + suas séries
  const { chartData, top, deltas } = useMemo(() => {
    const byPl = new Map<string, Hist[]>();
    hist.forEach(h => {
      const arr = byPl.get(h.playlist_id) ?? [];
      arr.push(h); byPl.set(h.playlist_id, arr);
    });
    const ranked = [...byPl.entries()]
      .map(([id, arr]) => ({ id, last: Number(arr[arr.length - 1]?.leadership_score) || 0, first: Number(arr[0]?.leadership_score) || 0, arr }))
      .sort((a, b) => b.last - a.last)
      .slice(0, 8);

    // merge into time-aligned chart data
    const daySet = new Set<string>();
    ranked.forEach(({ arr }) => arr.forEach(p => daySet.add(p.captured_at.slice(0, 10))));
    const days = [...daySet].sort();
    const chartData = days.map(d => {
      const row: any = { t: d };
      ranked.forEach(({ id, arr }) => {
        const point = arr.find(p => p.captured_at.slice(0, 10) === d);
        if (point) row[id] = Number(point.leadership_score) || 0;
      });
      return row;
    });

    const deltas = ranked.map(r => ({
      id: r.id,
      name: names.get(r.id) ?? r.id.slice(0, 8),
      now: r.last,
      delta: r.first > 0 ? ((r.last - r.first) / r.first) * 100 : null,
    }));

    return { chartData, top: ranked, deltas };
  }, [hist, names]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Evolução de liderança</h3>
          <p className="text-[12px] text-muted-foreground">top 8 playlists e como o leadership_score se moveu</p>
        </div>
        <WindowSelector value={window} onChange={setWindow} />
      </div>

      {loading ? <Skeleton className="h-80" /> : top.length === 0 ? (
        <div className="nx-card p-8 text-center text-sm text-muted-foreground">
          Sem histórico de liderança ainda. Os snapshots diários alimentam este gráfico.
        </div>
      ) : (
        <>
          <div className="nx-card p-4 h-80">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => names.get(String(v)) ?? String(v).slice(0, 8)} />
                {top.map((r, i) => (
                  <Line key={r.id} type="monotone" dataKey={r.id} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {deltas.map((d) => (
              <div key={d.id} className="nx-card p-3">
                <p className="text-[12px] font-medium truncate">{d.name}</p>
                <div className="flex items-end justify-between mt-1">
                  <p className="text-lg font-semibold">{d.now.toFixed(2)}</p>
                  <TrendBadge delta={d.delta} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
