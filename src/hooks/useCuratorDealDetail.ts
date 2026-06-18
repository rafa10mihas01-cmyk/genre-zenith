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
  uploads: CampaignSpreadsheetUpload[];
};

export type CampaignSpreadsheetUpload = {
  id: string;
  deal_id: string | null;
  song_id: string | null;
  file_name: string | null;
  rows_imported: number | null;
  total_streams: number | null;
  reference_date: string | null;
  created_at: string;
  is_baseline: boolean | null;
  status: string | null;
};

function spotifyTrackId(input: unknown): string | null {
  const raw = String(input ?? "").trim();
  const m = raw.match(/track\/([A-Za-z0-9]{16,})/);
  if (m?.[1]) return m[1];
  return /^[A-Za-z0-9]{16,}$/.test(raw) ? raw : null;
}

function normText(input: unknown): string {
  return String(input ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function useCuratorDealDetail(dealId: string | null | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const detailKey = useMemo(() => ["curator_deal_detail", dealId] as const, [dealId]);
  const progressKey = useMemo(() => ["curator-progress", dealId] as const, [dealId]);

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
      const deal = dealRes.data as CuratorDeal | null;
      let uploads: CampaignSpreadsheetUpload[] = [];
      if (deal) {
        const uploadDealIds = new Set<string>([deal.id]);
        const campaignId = (deal as CuratorDeal & { campaign_id?: string | null }).campaign_id ?? null;
        if (campaignId) {
          const thisTrack = spotifyTrackId(deal.song_spotify_url);
          const thisName = normText(deal.song_name);
          const { data: siblings } = await supabase
            .from("curator_deals")
            .select("id, song_name, song_spotify_url")
            .eq("campaign_id", campaignId);
          for (const sibling of (siblings ?? []) as Array<{ id: string; song_name: string | null; song_spotify_url: string | null }>) {
            const sameTrack = thisTrack && spotifyTrackId(sibling.song_spotify_url) === thisTrack;
            const sameName = thisName && normText(sibling.song_name) === thisName;
            if (sameTrack || sameName) uploadDealIds.add(sibling.id);
          }
        }
        const { data: uploadRows, error: uploadsErr } = await supabase
          .from("label_spreadsheet_uploads")
          .select("id, deal_id, song_id, file_name, rows_imported, total_streams, reference_date, created_at, is_baseline, status")
          .in("deal_id", Array.from(uploadDealIds))
          .order("reference_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(500);
        if (uploadsErr) throw uploadsErr;
        uploads = (uploadRows ?? []) as CampaignSpreadsheetUpload[];
      }
      return {
        deal,
        logs: (logsRes.data ?? []) as CuratorDealLog[],
        playlists: ((plRes.data ?? []) as CuratorPlaylist[]).map((p) => ({
          ...p,
          match_status:
            (p.match_status as string) === "algorithmic" ? "editorial" : p.match_status,
        })) as CuratorPlaylist[],
        songs: (songsRes.data ?? []) as CuratorDealSong[],
        alerts: (alertsRes.data ?? []) as CuratorFraudAlert[],
        uploads,
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
  const logs = useMemo(() => data?.logs ?? [], [data?.logs]);
  const playlists = useMemo(() => data?.playlists ?? [], [data?.playlists]);
  const songs = useMemo(() => data?.songs ?? [], [data?.songs]);
  const alerts = useMemo(() => data?.alerts ?? [], [data?.alerts]);
  const uploads = useMemo(() => data?.uploads ?? [], [data?.uploads]);
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
    uploads,
    progress,
    // loading só "verdadeiro" quando não há dado anterior — com placeholderData global,
    // trocar de ID mantém o dado antigo visível.
    loading: detailQuery.isLoading && !detailQuery.data,
    error: detailQuery.error ? (detailQuery.error as Error).message : null,
    reload,
  };
}
