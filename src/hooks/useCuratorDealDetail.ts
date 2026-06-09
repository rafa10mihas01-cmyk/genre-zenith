// useCuratorDealDetail(dealId) — detalhe completo de um deal.
// Refatorado para React Query: navegação instantânea entre /deals/:id.
import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type {
  CuratorDeal,
  CuratorDealLog,
  CuratorPlaylist,
  CuratorDealSong,
  CuratorDealProgress,
} from "@/lib/curatorDealsUtils";
import type { CuratorFraudAlert } from "@/hooks/useCuratorDeals";

type DealDetailData = {
  deal: CuratorDeal | null;
  logs: CuratorDealLog[];
  playlists: CuratorPlaylist[];
  songs: CuratorDealSong[];
  alerts: CuratorFraudAlert[];
};

export function useCuratorDealDetail(dealId: string | null | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const detailKey = ["curator_deal_detail", dealId] as const;
  const progressKey = ["curator-progress", dealId] as const;

  const detailQuery = useQuery({
    queryKey: detailKey,
    enabled: !!user && !!dealId,
    queryFn: async (): Promise<DealDetailData> => {
      const [dealRes, logsRes, plRes, songsRes, alertsRes] = await Promise.all([
        supabase.from("curator_deals").select("*").eq("id", dealId!).maybeSingle(),
        supabase
          .from("curator_deal_logs")
          .select("*")
          .eq("deal_id", dealId!)
          .order("created_at", { ascending: true })
          .limit(5000),
        supabase
          .from("v_curator_playlists_operational")
          .select("*")
          .eq("deal_id", dealId!)
          .order("added_at", { ascending: true })
          .limit(2000),
        supabase
          .from("curator_deal_songs")
          .select("*")
          .eq("deal_id", dealId!)
          .order("position", { ascending: true })
          .limit(2000),
        supabase
          .from("curator_fraud_alerts")
          .select("*")
          .eq("deal_id", dealId!)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (dealRes.error) throw dealRes.error;
      if (logsRes.error) throw logsRes.error;
      if (plRes.error) throw plRes.error;
      if (songsRes.error) throw songsRes.error;
      if (alertsRes.error) throw alertsRes.error;
      return {
        deal: (dealRes.data ?? null) as CuratorDeal | null,
        logs: (logsRes.data ?? []) as CuratorDealLog[],
        playlists: ((plRes.data ?? []) as CuratorPlaylist[]).map((p) => ({
          ...p,
          match_status:
            (p.match_status as string) === "algorithmic" ? "editorial" : p.match_status,
        })) as CuratorPlaylist[],
        songs: (songsRes.data ?? []) as CuratorDealSong[],
        alerts: (alertsRes.data ?? []) as CuratorFraudAlert[],
      };
    },
  });

  const progressQuery = useQuery({
    queryKey: progressKey,
    queryFn: async (): Promise<CuratorDealProgress | null> => {
      if (!dealId) return null;
      const { data, error: rpcErr } = await supabase.rpc(
        "get_curator_deal_progress",
        { p_deal_id: dealId },
      );
      if (rpcErr) throw rpcErr;
      return (data ?? null) as CuratorDealProgress | null;
    },
    enabled: !!dealId,
    staleTime: 30_000,
  });

  const data = detailQuery.data;
  const deal = data?.deal ?? null;
  const logs = data?.logs ?? [];
  const playlists = data?.playlists ?? [];
  const songs = data?.songs ?? [];
  const alerts = data?.alerts ?? [];
  const progress = progressQuery.data ?? null;

  const reload = useCallback(() => {
    qc.invalidateQueries({ queryKey: detailKey });
    qc.invalidateQueries({ queryKey: progressKey });
  }, [qc, detailKey, progressKey]);

  // Polling de fallback enquanto alguma música está em coleta ativa.
  const hasActiveCollection = useMemo(
    () =>
      songs.some(
        (s) =>
          s.auto_collect_status === "queued" || s.auto_collect_status === "collecting",
      ),
    [songs],
  );
  useEffect(() => {
    if (!hasActiveCollection) return;
    const id = setInterval(() => { reload(); }, 5000);
    return () => clearInterval(id);
  }, [hasActiveCollection, reload]);

  // Realtime ESCOPADO ao deal.
  useEffect(() => {
    if (!user || !dealId) return;
    const channel = supabase
      .channel(`curator-deal-detail-${dealId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deals", filter: `id=eq.${dealId}` },
        () => { qc.invalidateQueries({ queryKey: detailKey }); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deal_snapshots", filter: `deal_id=eq.${dealId}` },
        () => { qc.invalidateQueries({ queryKey: progressKey }); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deal_songs", filter: `deal_id=eq.${dealId}` },
        () => {
          qc.invalidateQueries({ queryKey: progressKey });
          qc.invalidateQueries({ queryKey: detailKey });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, dealId, qc, detailKey, progressKey]);

  return {
    deal,
    logs,
    playlists,
    songs,
    alerts,
    progress,
    // loading só "verdadeiro" quando não há dado anterior — com placeholderData global,
    // trocar de ID mantém o dado antigo visível.
    loading: detailQuery.isLoading && !detailQuery.data,
    error: detailQuery.error ? (detailQuery.error as Error).message : null,
    reload,
  };
}
