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
  total_delivered: number;
  baseline_total: number;
};

export type TodayBreakdown = {
  total_today: number;
  total_24h: number | null;
  total_7d: number | null;
  total_28d: number | null;
  total_delivered: number;
  rows: TodayPlaylistRow[];
};

const EMPTY: TodayBreakdown = {
  total_today: 0,
  total_24h: null,
  total_7d: null,
  total_28d: null,
  total_delivered: 0,
  rows: [],
};

// Soma tratando null como "sem dado": se nenhuma linha tiver valor,
// retorna null (para exibir "—" em vez de 0).
function sumNullable(vals: Array<number | null>): number | null {
  let sum = 0;
  let has = false;
  for (const v of vals) {
    if (v != null && Number.isFinite(v)) {
      sum += v;
      has = true;
    }
  }
  return has ? sum : null;
}

type SnapshotRow = {
  playlist_id: string | null;
  plays: number | null;
  plays_24h: number | null;
  plays_7d: number | null;
  plays_28d: number | null;
  captured_at: string;
  is_baseline: boolean | null;
};

type PlaylistMetaRow = {
  id: string;
  playlist_name: string | null;
  spotify_url: string | null;
  spotify_owner_name: string | null;
  image_url: string | null;
  match_status: string | null;
  is_baseline: boolean | null;
};

export function useDealTodayPlaylistBreakdown(dealId: string | null | undefined) {
  return useQuery({
    queryKey: ["deal-today-playlist-breakdown", dealId],
    enabled: !!dealId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<TodayBreakdown> => {
      if (!dealId) return EMPTY;

      const snaps: SnapshotRow[] = [];
      const pageSize = 1000;
      for (let from = 0; from < 20_000; from += pageSize) {
        const { data, error } = await supabase
          .from("curator_deal_snapshots")
          .select("playlist_id, plays, plays_24h, plays_7d, plays_28d, captured_at, is_baseline")
          .eq("deal_id", dealId)
          .order("captured_at", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        snaps.push(...((data ?? []) as SnapshotRow[]));
        if (!data || data.length < pageSize) break;
      }

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
        todayLast: LastSnap | null;
        prev: { plays: number; at: string } | null;
        baseline: { plays: number; at: string } | null;
      };
      const map = new Map<string, Bucket>();
      for (const s of snaps) {
        if (!s.playlist_id) continue;
        const day = String(s.captured_at).slice(0, 10);
        const lastSnap: LastSnap = {
          plays: Number(s.plays ?? 0),
          at: s.captured_at,
          plays_24h: s.plays_24h != null ? Number(s.plays_24h) : null,
          plays_7d: s.plays_7d != null ? Number(s.plays_7d) : null,
          plays_28d: s.plays_28d != null ? Number(s.plays_28d) : null,
        };
        const b = map.get(s.playlist_id) ?? { last: null, todayLast: null, prev: null, baseline: null };
        if (!b.last || s.captured_at > b.last.at) b.last = lastSnap;
        if (s.is_baseline && (!b.baseline || s.captured_at > b.baseline.at)) {
          b.baseline = { plays: Number(s.plays ?? 0), at: s.captured_at };
        }
        if (day === todayKey) {
          if (!b.todayLast || s.captured_at > b.todayLast.at) b.todayLast = lastSnap;
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
        // Separação operacional × observacional
        .from("v_curator_playlists_operational")
        .select("id, playlist_name, spotify_url, spotify_owner_name, image_url, match_status, is_baseline")
        .in("id", playlistIds);

      const plMap = new Map(((playlists ?? []) as PlaylistMetaRow[]).map((p) => [p.id, p]));

      const rows: TodayPlaylistRow[] = playlistIds.map((pid) => {
        const b = map.get(pid)!;
        const pl = plMap.get(pid);
        const last = b.last!;
        const todayLast = b.todayLast;
        const prev = b.prev;
        const previousTotal = prev ? prev.plays : 0;
        const delta = todayLast ? Math.max(0, todayLast.plays - previousTotal) : 0;
        const baselineTotal = b.baseline?.plays ?? 0;
        const totalDelivered = Math.max(0, last.plays - baselineTotal);
        return {
          playlist_id: pid,
          playlist_name: pl?.playlist_name ?? "(playlist removida)",
          spotify_url: pl?.spotify_url ?? null,
          spotify_owner_name: pl?.spotify_owner_name ?? null,
          image_url: pl?.image_url ?? null,
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
          total_delivered: totalDelivered,
          baseline_total: baselineTotal,
        };
      });

      rows.sort((a, b) => b.total_delivered - a.total_delivered || b.today_plays - a.today_plays);
      const total_today = rows.reduce((s, r) => s + r.today_plays, 0);
      const total_24h = sumNullable(rows.map((r) => r.plays_24h));
      const total_7d = sumNullable(rows.map((r) => r.plays_7d));
      const total_28d = sumNullable(rows.map((r) => r.plays_28d));
      const total_delivered = rows.reduce((s, r) => s + r.total_delivered, 0);
      return { total_today, total_24h, total_7d, total_28d, total_delivered, rows };
    },
  });
}
