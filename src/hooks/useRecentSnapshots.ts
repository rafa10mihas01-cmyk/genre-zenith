// Fase 4B.1 — query única e compartilhada de playlist_metrics_snapshots dos
// últimos N dias. Substitui 3 queries idênticas (CatalogHealth, WeeklySummary,
// PlaylistsInDecline). Retorna os snapshots brutos ordenados + um índice
// pré-calculado (firstTs/lastTs) reutilizável.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Snap = {
  spotify_playlist_id: string;
  followers: number;
  collected_at: string;
};

export type SnapIndex = {
  first: number;
  last: number;
  firstTs: number;
  lastTs: number;
};

export type RecentSnapshotsResult = {
  snaps: Snap[];
  index: Map<string, SnapIndex>;
};

const DEFAULT_DAYS = 8;
const DEFAULT_LIMIT = 8000;

export function useRecentSnapshots(days: number = DEFAULT_DAYS, limit: number = DEFAULT_LIMIT) {
  return useQuery({
    queryKey: ["recent_snapshots", days, limit],
    staleTime: 60_000,
    queryFn: async (): Promise<RecentSnapshotsResult> => {
      const sinceISO = new Date(Date.now() - days * 86400000).toISOString();
      const { data, error } = await supabase
        .from("playlist_metrics_snapshots")
        .select("spotify_playlist_id, followers, collected_at")
        .gte("collected_at", sinceISO)
        .order("collected_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      const snaps = (data ?? []) as Snap[];
      const index = new Map<string, SnapIndex>();
      for (const r of snaps) {
        const ts = new Date(r.collected_at).getTime();
        const cur = index.get(r.spotify_playlist_id);
        if (!cur) {
          index.set(r.spotify_playlist_id, { first: r.followers, last: r.followers, firstTs: ts, lastTs: ts });
        } else {
          if (ts < cur.firstTs) { cur.first = r.followers; cur.firstTs = ts; }
          if (ts > cur.lastTs) { cur.last = r.followers; cur.lastTs = ts; }
        }
      }
      return { snaps, index };
    },
  });
}
