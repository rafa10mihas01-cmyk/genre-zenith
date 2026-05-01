// usePlaylistDeals — camada de dados do módulo Playlist Deals.
// Segue o padrão dos hooks existentes (useAutopilot, useNotifications,
// useBriefings): SDK Supabase direto dentro de useEffect/useCallback,
// sem React Query.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { PlaylistDeal, PlaylistDealLog } from "@/lib/playlistDealsUtils";

export type NewDealInput = {
  song: string;
  playlist: string;
  curator?: string | null;
  spotify_url?: string | null;
  target: number;
  start_plays?: number;
  cost?: number | null;
};

export type NewLogInput = {
  deal_id: string;
  count: number;
  note?: string | null;
};

export function usePlaylistDeals() {
  const { user } = useAuth();
  const [deals, setDeals] = useState<PlaylistDeal[]>([]);
  const [logs, setLogs] = useState<PlaylistDealLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setDeals([]);
      setLogs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: dealsData, error: dealsErr } = await supabase
        .from("playlist_deals")
        .select("*")
        .order("created_at", { ascending: false });
      if (dealsErr) throw dealsErr;
      const dealsRows = (dealsData ?? []) as PlaylistDeal[];
      setDeals(dealsRows);

      const dealIds = dealsRows.map((d) => d.id);
      if (dealIds.length === 0) {
        setLogs([]);
      } else {
        const { data: logsData, error: logsErr } = await supabase
          .from("playlist_deal_logs")
          .select("*")
          .in("deal_id", dealIds)
          .order("created_at", { ascending: true });
        if (logsErr) throw logsErr;
        setLogs((logsData ?? []) as PlaylistDealLog[]);
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
    async (input: NewDealInput) => {
      if (!user) throw new Error("Usuário não autenticado");
      const { data, error: insertErr } = await supabase
        .from("playlist_deals")
        .insert({
          user_id: user.id,
          song: input.song,
          playlist: input.playlist,
          curator: input.curator ?? null,
          spotify_url: input.spotify_url ?? null,
          target: input.target,
          start_plays: input.start_plays ?? 0,
          cost: input.cost ?? null,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;
      await load();
      return data as PlaylistDeal;
    },
    [user, load],
  );

  const deleteDeal = useCallback(
    async (id: string) => {
      const { error: delErr } = await supabase
        .from("playlist_deals")
        .delete()
        .eq("id", id);
      if (delErr) throw delErr;
      await load();
    },
    [load],
  );

  const addLog = useCallback(
    async (input: NewLogInput) => {
      const { data, error: insertErr } = await supabase
        .from("playlist_deal_logs")
        .insert({
          deal_id: input.deal_id,
          count: input.count,
          note: input.note ?? null,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;
      await load();
      return data as PlaylistDealLog;
    },
    [load],
  );

  return { deals, logs, loading, error, addDeal, deleteDeal, addLog, reload: load };
}
