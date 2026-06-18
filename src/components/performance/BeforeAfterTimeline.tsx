import { useEffect, useState } from "react";
import { ImageIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatNumber, timeAgo } from "@/lib/format";

type Event = {
  template_id: string;
  name: string;
  spotify_playlist_id: string;
  cover_generated_at: string;
  followers_before: number | null;
  followers_after: number | null;
  delta: number | null;
  windowDays: number;
};

const WINDOW_DAYS = 7;

/**
 * Linha do tempo "Antes / Depois": cada vez que uma capa nova foi gerada,
 * compara followers nos snapshots N dias antes vs N dias depois.
 */
export function BeforeAfterTimeline() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: tpls } = await supabase
        .from("playlist_templates")
        .select("id, name, spotify_playlist_id, cover_generated_at")
        .not("spotify_playlist_id", "is", null)
        .not("cover_generated_at", "is", null)
        .order("cover_generated_at", { ascending: false })
        .limit(20);

      if (!tpls || tpls.length === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }

      const ids = tpls.map((t) => t.spotify_playlist_id);
      const { data: snaps } = await supabase
        .from("playlist_metrics_snapshots")
        .select("spotify_playlist_id, followers, collected_at")
        .in("spotify_playlist_id", ids)
        .order("collected_at", { ascending: true })
        .limit(5000);

      const byPid = new Map<string, Array<{ ts: number; f: number }>>();
      for (const s of (snaps ?? []) as any[]) {
        const arr = byPid.get(s.spotify_playlist_id) ?? [];
        arr.push({ ts: new Date(s.collected_at).getTime(), f: s.followers });
        byPid.set(s.spotify_playlist_id, arr);
      }

      const evts: Event[] = tpls.map((t) => {
        const eventTs = new Date(t.cover_generated_at).getTime();
        const series = byPid.get(t.spotify_playlist_id) ?? [];
        const before = nearest(series, eventTs - WINDOW_DAYS * 86400000, eventTs);
        const after = nearest(series, eventTs + WINDOW_DAYS * 86400000, null, eventTs);
        const delta = before !== null && after !== null ? after - before : null;
        return {
          template_id: t.id,
          name: t.name ?? "Sem nome",
          spotify_playlist_id: t.spotify_playlist_id,
          cover_generated_at: t.cover_generated_at,
          followers_before: before,
          followers_after: after,
          delta,
          windowDays: WINDOW_DAYS,
        };
      });

      setEvents(evts);
      setLoading(false);
    })();
  }, []);

  const withDelta = events.filter(e => e.delta !== null);

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-primary" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Antes / Depois — Capas novas
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">janela ±{WINDOW_DAYS}d</span>
      </div>

      {loading ? (
        <div className="h-32 rounded-md bg-muted/40 animate-pulse" />
      ) : events.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">
          Nenhuma capa nova registrada ainda.
        </div>
      ) : withDelta.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">
          Aguardando histórico suficiente para comparar antes / depois.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {withDelta.slice(0, 8).map(e => {
            const positive = (e.delta ?? 0) > 0;
            const neutral = (e.delta ?? 0) === 0;
            const Icon = neutral ? Minus : positive ? TrendingUp : TrendingDown;
            const tone = neutral ? "text-muted-foreground" : positive ? "text-success" : "text-destructive";
            return (
              <li key={e.template_id} className="flex items-center gap-3 py-3">
                <Icon className={cn("h-4 w-4 shrink-0", tone)} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate leading-tight">{e.name}</div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {formatNumber(e.followers_before)} → {formatNumber(e.followers_after)} • há {timeAgo(e.cover_generated_at)}
                  </div>
                </div>
                <div className={cn("text-sm font-bold tabular-nums shrink-0", tone)}>
                  {positive ? "+" : ""}{formatNumber(e.delta)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Retorna o followers do snapshot mais próximo do alvo dentro de [floor, ceil]. */
function nearest(
  series: Array<{ ts: number; f: number }>,
  target: number,
  ceil: number | null,
  floor: number | null = null,
): number | null {
  if (series.length === 0) return null;
  const min = floor ?? -Infinity;
  const max = ceil ?? Infinity;
  let best: { ts: number; f: number } | null = null;
  for (const s of series) {
    if (s.ts < min || s.ts > max) continue;
    if (!best || Math.abs(s.ts - target) < Math.abs(best.ts - target)) best = s;
  }
  return best?.f ?? null;
}
