// useCuratorDealDetail(dealId) — carrega APENAS o que precisa para a tela de
// detalhe de UM deal: o próprio deal + logs + songs + playlists + alertas (open)
// + progress via RPC.
//
// Evita puxar a base inteira como faz o useCuratorDeals tradicional.
// Use em /playlist-deals/:dealId.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export function useCuratorDealDetail(dealId: string | null | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [deal, setDeal] = useState<CuratorDeal | null>(null);
  const [logs, setLogs] = useState<CuratorDealLog[]>([]);
  const [playlists, setPlaylists] = useState<CuratorPlaylist[]>([]);
  const [songs, setSongs] = useState<CuratorDealSong[]>([]);
  const [alerts, setAlerts] = useState<CuratorFraudAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!user || !dealId) {
      hasLoadedRef.current = false;
      setDeal(null);
      setLogs([]);
      setPlaylists([]);
      setSongs([]);
      setAlerts([]);
      setLoading(false);
      return;
    }
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    try {
      const [dealRes, logsRes, plRes, songsRes, alertsRes] = await Promise.all([
        supabase.from("curator_deals").select("*").eq("id", dealId).maybeSingle(),
        supabase
          .from("curator_deal_logs")
          .select("*")
          .eq("deal_id", dealId)
          .order("created_at", { ascending: true })
          .limit(5000),
        supabase
          // Separação operacional × observacional: detalhe do deal usa apenas curadoria entregue
          .from("v_curator_playlists_operational")
          .select("*")
          .eq("deal_id", dealId)
          .order("added_at", { ascending: true })
          .limit(2000),
        supabase
          .from("curator_deal_songs")
          .select("*")
          .eq("deal_id", dealId)
          .order("position", { ascending: true })
          .limit(2000),
        supabase
          .from("curator_fraud_alerts")
          .select("*")
          .eq("deal_id", dealId)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (dealRes.error) throw dealRes.error;
      if (logsRes.error) throw logsRes.error;
      if (plRes.error) throw plRes.error;
      if (songsRes.error) throw songsRes.error;
      if (alertsRes.error) throw alertsRes.error;
      setDeal((dealRes.data ?? null) as CuratorDeal | null);
      setLogs((logsRes.data ?? []) as CuratorDealLog[]);
      setPlaylists(
        ((plRes.data ?? []) as CuratorPlaylist[]).map((p) => ({
          ...p,
          match_status:
            (p.match_status as string) === "algorithmic" ? "editorial" : p.match_status,
        })) as CuratorPlaylist[],
      );
      setSongs((songsRes.data ?? []) as CuratorDealSong[]);
      setAlerts((alertsRes.data ?? []) as CuratorFraudAlert[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, [user, dealId]);

  useEffect(() => {
    load();
  }, [load]);

  // Progress via RPC, com cache TanStack (mesmo padrão do useCuratorDeals).
  const progressQuery = useQuery({
    queryKey: ["curator-progress", dealId] as const,
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
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const progress = progressQuery.data ?? null;

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
    const id = setInterval(() => {
      load();
    }, 5000);
    return () => clearInterval(id);
  }, [hasActiveCollection, load]);

  // Realtime ESCOPADO ao deal: só reage a mudanças desse deal.
  useEffect(() => {
    if (!user || !dealId) return;
    const channel = supabase
      .channel(`curator-deal-detail-${dealId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deals", filter: `id=eq.${dealId}` },
        () => {
          load();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "curator_deal_snapshots",
          filter: `deal_id=eq.${dealId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["curator-progress", dealId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "curator_deal_songs",
          filter: `deal_id=eq.${dealId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["curator-progress", dealId] });
          load();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, dealId, queryClient, load]);

  return {
    deal,
    logs,
    playlists,
    songs,
    alerts,
    progress,
    loading,
    error,
    reload: load,
  };
}
