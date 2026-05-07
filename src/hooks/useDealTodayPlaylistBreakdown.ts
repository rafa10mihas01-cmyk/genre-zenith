// useDealTodayPlaylistBreakdown — Mostra a contribuição de plays "hoje"
// por playlist do deal. Calcula delta = último snapshot de hoje
// menos o último snapshot de qualquer dia anterior (ou baseline) para a
// mesma playlist. Permite o usuário auditar os números do card.
// Também devolve plays_24h/7d/28d do snapshot mais recente para suporte
// à aba "Performance" (janela oficial do Spotify for Artists).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TodayPlaylistRow = {
  playlist_id: string;
  playlist_name: string;
  spotify_url: string | null;
  spotify_owner_name: string | null;
  image_url: string | null;
  match_status: string;
  is_baseline: boolean;
  today_plays: number;
  last_total: number;
  previous_total: number;
  last_captured_at: string;
  previous_captured_at: string | null;
  plays_24h: number | null;
  plays_7d: number | null;
  plays_28d: number | null;
};

export type TodayBreakdown = {
  total_today: number;
  total_24h: number;
  total_7d: number;
  total_28d: number;
  rows: TodayPlaylistRow[];
};

const EMPTY: TodayBreakdown = {
  total_today: 0,
  total_24h: 0,
  total_7d: 0,
  total_28d: 0,
  rows: [],
};

export function useDealTodayPlaylistBreakdown(dealId: string | null | undefined) {
  return useQuery({
    queryKey: ["deal-today-playlist-breakdown", dealId],
    enabled: !!dealId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<TodayBreakdown> => {
      if (!dealId) return EMPTY;

      const sinceIso = new Date(Date.now() - 8 * 86400_000).toISOString();
      const { data: snaps, error } = await supabase
        .from("curator_deal_snapshots")
        .select("playlist_id, plays, plays_24h, plays_7d, plays_28d, captured_at, is_baseline")
        .eq("deal_id", dealId)
        .gte("captured_at", sinceIso)
        .order("captured_at", { ascending: true });
      if (error) throw error;

      const todayKey = new Date().toISOString().slice(0, 10);

      type LastSnap = {
        plays: number;
        at: string;
        plays_24h: number | null;
        plays_7d: number | null;
        plays_28d: number | null;
      };
      type Bucket = {
        last: LastSnap | null;
        prev: { plays: number; at: string } | null;
      };
      const map = new Map<string, Bucket>();
      for (const s of (snaps ?? []) as any[]) {
        if (!s.playlist_id) continue;
        const day = String(s.captured_at).slice(0, 10);
        const b = map.get(s.playlist_id) ?? { last: null, prev: null };
        if (day === todayKey) {
          if (!b.last || s.captured_at > b.last.at) {
            b.last = {
              plays: Number(s.plays ?? 0),
              at: s.captured_at,
              plays_24h: s.plays_24h != null ? Number(s.plays_24h) : null,
              plays_7d: s.plays_7d != null ? Number(s.plays_7d) : null,
              plays_28d: s.plays_28d != null ? Number(s.plays_28d) : null,
            };
          }
        } else {
          if (!b.prev || s.captured_at > b.prev.at) {
            b.prev = { plays: Number(s.plays ?? 0), at: s.captured_at };
          }
        }
        map.set(s.playlist_id, b);
      }

      const playlistIds = Array.from(map.keys()).filter((id) => !!map.get(id)!.last);
      if (playlistIds.length === 0) return EMPTY;

      const { data: playlists } = await supabase
        .from("curator_playlists")
        .select("id, playlist_name, spotify_url, spotify_owner_name, match_status, is_baseline")
        .in("id", playlistIds);

      const plMap = new Map((playlists ?? []).map((p: any) => [p.id, p]));

      const rows: TodayPlaylistRow[] = playlistIds.map((pid) => {
        const b = map.get(pid)!;
        const pl = plMap.get(pid) as any;
        const last = b.last!;
        const prev = b.prev;
        const previousTotal = prev ? prev.plays : 0;
        const delta = Math.max(0, last.plays - previousTotal);
        return {
          playlist_id: pid,
          playlist_name: pl?.playlist_name ?? "(playlist removida)",
          spotify_url: pl?.spotify_url ?? null,
          spotify_owner_name: pl?.spotify_owner_name ?? null,
          match_status: pl?.match_status ?? "curator",
          is_baseline: !!pl?.is_baseline,
          today_plays: delta,
          last_total: last.plays,
          previous_total: previousTotal,
          last_captured_at: last.at,
          previous_captured_at: prev?.at ?? null,
          plays_24h: last.plays_24h,
          plays_7d: last.plays_7d,
          plays_28d: last.plays_28d,
        };
      });

      rows.sort((a, b) => b.today_plays - a.today_plays);
      const total_today = rows.reduce((s, r) => s + r.today_plays, 0);
      const total_24h = rows.reduce((s, r) => s + (r.plays_24h ?? 0), 0);
      const total_7d = rows.reduce((s, r) => s + (r.plays_7d ?? 0), 0);
      const total_28d = rows.reduce((s, r) => s + (r.plays_28d ?? 0), 0);
      return { total_today, total_24h, total_7d, total_28d, rows };
    },
  });
}
