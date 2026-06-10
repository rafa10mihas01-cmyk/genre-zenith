// useDealTodayPlaylistBreakdown — Mostra a contribuição de plays "hoje"
// por playlist do deal.
//
// FONTE OFICIAL (pós P2.1/P2.2): vw_campaign_playlist_growth — mesma view
// que alimenta o portal do cliente, indexada por (campaign_id, spotify_playlist_id).
// A tabela legada `curator_deal_snapshots` ficou vazia após a migração do
// Growth Engine e não deve mais ser usada para métricas por playlist.
//
// Mapeamento:
//   today_plays      = last_import_delta   (entrega da última importação válida)
//   total_delivered  = delivery_accumulated (Δ entrega acumulada, oficial)
//   plays_7d         = current_plays        (último plays/7d do S4A)
//   plays_28d        = null                 (não disponível por playlist)
//   baseline_total   = baseline_plays
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

export function useDealTodayPlaylistBreakdown(dealId: string | null | undefined) {
  return useQuery({
    queryKey: ["deal-today-playlist-breakdown", dealId, "growth-engine-v2"],
    enabled: !!dealId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<TodayBreakdown> => {
      if (!dealId) return EMPTY;

      // 1) Deal → campaign_id
      const { data: deal, error: dealErr } = await supabase
        .from("curator_deals")
        .select("id, campaign_id")
        .eq("id", dealId)
        .maybeSingle();
      if (dealErr) throw dealErr;
      if (!deal) return EMPTY;

      // 2) Playlists cadastradas no deal (cadastro operacional)
      const { data: plays, error: plErr } = await supabase
        .from("v_curator_playlists_operational")
        .select(
          "id, spotify_playlist_id, spotify_url, playlist_name, spotify_owner_name, image_url, match_status, is_baseline",
        )
        .eq("deal_id", dealId)
        .limit(2000);
      if (plErr) throw plErr;
      const playlists = plays ?? [];
      if (playlists.length === 0) return EMPTY;

      // 3) Growth oficial por (campaign_id, spotify_playlist_id)
      const spotifyIds = Array.from(
        new Set(
          playlists
            .map((p: any) => p.spotify_playlist_id)
            .filter((id: string | null) => !!id),
        ),
      ) as string[];

      let growthMap = new Map<
        string,
        {
          delivery_accumulated: number;
          last_import_delta: number | null;
          current_plays: number | null;
          baseline_plays: number | null;
          last_captured_at: string | null;
          baseline_at: string | null;
        }
      >();

      if (spotifyIds.length > 0 && deal.campaign_id) {
        const { data: growth, error: gErr } = await supabase
          .from("vw_campaign_playlist_growth")
          .select(
            "playlist_id, delivery_accumulated, last_import_delta, current_plays, baseline_plays, last_captured_at, baseline_at",
          )
          .eq("campaign_id", deal.campaign_id)
          .in("playlist_id", spotifyIds);
        if (gErr) throw gErr;
        for (const g of growth ?? []) {
          if (!g.playlist_id) continue;
          growthMap.set(g.playlist_id, {
            delivery_accumulated: Number(g.delivery_accumulated ?? 0),
            last_import_delta:
              g.last_import_delta != null ? Number(g.last_import_delta) : null,
            current_plays: g.current_plays != null ? Number(g.current_plays) : null,
            baseline_plays:
              g.baseline_plays != null ? Number(g.baseline_plays) : null,
            last_captured_at: g.last_captured_at ?? null,
            baseline_at: g.baseline_at ?? null,
          });
        }
      }

      const rows: TodayPlaylistRow[] = playlists.map((p: any) => {
        const g = p.spotify_playlist_id ? growthMap.get(p.spotify_playlist_id) : null;
        const totalDelivered = g?.delivery_accumulated ?? 0;
        const today = g?.last_import_delta ?? 0;
        const baseline = g?.baseline_plays ?? 0;
        const current = g?.current_plays ?? baseline;
        return {
          playlist_id: p.id,
          playlist_name: p.playlist_name ?? "(playlist removida)",
          spotify_url: p.spotify_url ?? null,
          spotify_owner_name: p.spotify_owner_name ?? null,
          image_url: p.image_url ?? null,
          match_status: p.match_status ?? "curator",
          is_baseline: !!p.is_baseline,
          today_plays: today,
          last_total: current,
          previous_total: Math.max(0, current - (today ?? 0)),
          last_captured_at: g?.last_captured_at ?? "",
          previous_captured_at: null,
          plays_24h: null,
          plays_7d: g?.current_plays ?? null,
          plays_28d: null,
          total_delivered: totalDelivered,
          baseline_total: baseline,
        };
      });

      rows.sort(
        (a, b) =>
          b.total_delivered - a.total_delivered || b.today_plays - a.today_plays,
      );

      const total_today = rows.reduce((s, r) => s + (r.today_plays ?? 0), 0);
      const total_7d = sumNullable(rows.map((r) => r.plays_7d));
      const total_delivered = rows.reduce((s, r) => s + r.total_delivered, 0);

      return {
        total_today,
        total_24h: null,
        total_7d,
        total_28d: null,
        total_delivered,
        rows,
      };
    },
  });
}
