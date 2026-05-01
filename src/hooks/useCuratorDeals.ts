// useCuratorDeals — camada de dados do módulo redesenhado de Curator Deals.
// Mesmo padrão dos demais hooks: SDK Supabase direto em useEffect/useCallback.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type {
  CuratorDeal,
  CuratorDealLog,
  CuratorPlaylist,
} from "@/lib/curatorDealsUtils";

export type NewCuratorDealInput = {
  curator_name: string;
  song_spotify_url: string;
  song_name: string;
  song_artist?: string | null;
  song_cover_url?: string | null;
  target_plays: number;
  baseline_plays?: number;
  cost?: number | null;
};

export type NewCuratorLogInput = {
  deal_id: string;
  total_plays: number;
  note?: string | null;
  is_baseline?: boolean;
  print_urls?: string[];
};

export type BaselinePlaylistInput = {
  spotify_url: string;
  playlist_name: string;
  followers?: number | null;
};

export function useCuratorDeals() {
  const { user } = useAuth();
  const [deals, setDeals] = useState<CuratorDeal[]>([]);
  const [logs, setLogs] = useState<CuratorDealLog[]>([]);
  const [playlists, setPlaylists] = useState<CuratorPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setDeals([]);
      setLogs([]);
      setPlaylists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: dealsData, error: dealsErr } = await supabase
        .from("curator_deals")
        .select("*")
        .order("created_at", { ascending: false });
      if (dealsErr) throw dealsErr;
      const dealsRows = (dealsData ?? []) as CuratorDeal[];
      setDeals(dealsRows);

      const dealIds = dealsRows.map((d) => d.id);
      if (dealIds.length === 0) {
        setLogs([]);
        setPlaylists([]);
      } else {
        const [logsRes, plRes] = await Promise.all([
          supabase
            .from("curator_deal_logs")
            .select("*")
            .in("deal_id", dealIds)
            .order("created_at", { ascending: true }),
          supabase
            .from("curator_playlists")
            .select("*")
            .in("deal_id", dealIds)
            .order("added_at", { ascending: true }),
        ]);
        if (logsRes.error) throw logsRes.error;
        if (plRes.error) throw plRes.error;
        setLogs((logsRes.data ?? []) as CuratorDealLog[]);
        setPlaylists((plRes.data ?? []) as CuratorPlaylist[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const addDeal = useCallback(
    async (input: NewCuratorDealInput) => {
      if (!user) throw new Error("Usuário não autenticado");
      const { data, error: insertErr } = await supabase
        .from("curator_deals")
        .insert({
          user_id: user.id,
          curator_name: input.curator_name,
          song_spotify_url: input.song_spotify_url,
          song_name: input.song_name,
          song_artist: input.song_artist ?? null,
          song_cover_url: input.song_cover_url ?? null,
          target_plays: input.target_plays,
          baseline_plays: input.baseline_plays ?? 0,
          cost: input.cost ?? null,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;
      await load();
      return data as CuratorDeal;
    },
    [user, load],
  );

  const deleteDeal = useCallback(
    async (id: string) => {
      const { error: delErr } = await supabase
        .from("curator_deals")
        .delete()
        .eq("id", id);
      if (delErr) throw delErr;
      await load();
    },
    [load],
  );

  const addLog = useCallback(
    async (input: NewCuratorLogInput) => {
      const { data, error: insertErr } = await supabase
        .from("curator_deal_logs")
        .insert({
          deal_id: input.deal_id,
          total_plays: input.total_plays,
          note: input.note ?? null,
          is_baseline: input.is_baseline ?? false,
          print_urls: input.print_urls ?? [],
        })
        .select()
        .single();
      if (insertErr) throw insertErr;
      await load();
      return data as CuratorDealLog;
    },
    [load],
  );

  const addBaseline = useCallback(
    async (
      dealId: string,
      plays: number,
      baselinePlaylists: BaselinePlaylistInput[],
      printUrls: string[] = [],
    ) => {
      // 1. Log baseline
      const { error: logErr } = await supabase
        .from("curator_deal_logs")
        .insert({
          deal_id: dealId,
          total_plays: plays,
          is_baseline: true,
          note: null,
          print_urls: printUrls,
        });
      if (logErr) throw logErr;

      // 2. Playlists baseline (se houver)
      if (baselinePlaylists.length > 0) {
        const rows = baselinePlaylists.map((p) => ({
          deal_id: dealId,
          spotify_url: p.spotify_url,
          playlist_name: p.playlist_name,
          followers: p.followers ?? null,
          is_baseline: true,
        }));
        const { error: plErr } = await supabase
          .from("curator_playlists")
          .insert(rows);
        if (plErr) throw plErr;
      }

      await load();
    },
    [load],
  );

  return {
    deals,
    logs,
    playlists,
    loading,
    error,
    addDeal,
    deleteDeal,
    addLog,
    addBaseline,
    reload: load,
  };
}
