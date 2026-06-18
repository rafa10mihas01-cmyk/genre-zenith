import { useEffect, useMemo, useState } from "react";
import { LineChart } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, LineChart as RLineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Range = "7d" | "30d" | "90d";

type Snap = {
  spotify_playlist_id: string;
  followers: number;
  collected_at: string;
};

type Point = { day: string; followers: number };

/**
 * Timeline agregada de followers (soma de todas as playlists publicadas).
 * Lê playlist_metrics_snapshots e agrupa por dia.
 * Mostra "Aguardando histórico" quando dados são insuficientes.
 */
export function FollowersTimeline({ playlistIds = [] }: { playlistIds?: string[] }) {
  const [range, setRange] = useState<Range>("30d");
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [loading, setLoading] = useState(true);
  const playlistKey = useMemo(() => playlistIds.slice().sort().join("|"), [playlistIds]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
      if (playlistIds.length === 0) {
        setSnaps([]);
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("playlist_metrics_snapshots")
        .select("spotify_playlist_id, followers, collected_at")
        .in("spotify_playlist_id", playlistIds)
        .gte("collected_at", since)
        .order("collected_at", { ascending: true })
        .limit(5000);
      setSnaps((data ?? []) as Snap[]);
      setLoading(false);
    })();
    // playlistKey é a chave serializada estável dos playlistIds; reagimos só a ela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, playlistKey]);

  const points = useMemo<Point[]>(() => {
    if (snaps.length === 0) return [];
    // Para cada dia, somar o último snapshot conhecido de cada playlist.
    const byPlaylistByDay = new Map<string, Map<string, number>>();
    for (const s of snaps) {
      const day = s.collected_at.slice(0, 10);
      let m = byPlaylistByDay.get(s.spotify_playlist_id);
      if (!m) { m = new Map(); byPlaylistByDay.set(s.spotify_playlist_id, m); }
      m.set(day, s.followers);
    }
    const allDays = Array.from(new Set(snaps.map(s => s.collected_at.slice(0, 10)))).sort();
    // Para cada dia, soma o followers mais recente de cada playlist <= esse dia
    const lastKnown = new Map<string, number>();
    return allDays.map(day => {
      let total = 0;
      for (const [pid, m] of byPlaylistByDay) {
        const v = m.get(day);
        if (v !== undefined) lastKnown.set(pid, v);
        const known = lastKnown.get(pid);
        if (known !== undefined) total += known;
      }
      return { day, followers: total };
    });
  }, [snaps]);

  const insufficient = !loading && points.length < 2;

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <LineChart className="h-4 w-4 text-primary" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Seguidores ao longo do tempo
          </span>
        </div>
        <div className="flex items-center gap-1">
          {(["7d", "30d", "90d"] as Range[]).map(r => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? "secondary" : "ghost"}
              className={cn("h-7 px-2.5 text-[11px] font-semibold rounded-full")}
              onClick={() => setRange(r)}
            >
              {r}
            </Button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="h-48 rounded-md bg-muted/40 animate-pulse" />
      ) : insufficient ? (
        <div className="h-48 flex flex-col items-center justify-center text-center gap-1">
          <p className="text-sm font-semibold">Aguardando histórico</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Coletas insuficientes no período. A coleta automática roda diariamente — volte em breve.
          </p>
        </div>
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <RLineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={d => d.slice(5)}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={42}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                formatter={(v: number) => [v.toLocaleString("pt-BR"), "Seguidores"]}
              />
              <Line
                type="monotone"
                dataKey="followers"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </RLineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
