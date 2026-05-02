// useCuratorDeals — camada de dados do módulo redesenhado de Curator Deals.
// Mesmo padrão dos demais hooks: SDK Supabase direto em useEffect/useCallback.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type {
  CuratorDeal,
  CuratorDealLog,
  CuratorPlaylist,
  CuratorDealSong,
} from "@/lib/curatorDealsUtils";

export type DealSongInput = {
  song_spotify_url: string;
  spotify_track_id?: string | null;
  song_name: string;
  song_artist?: string | null;
  song_cover_url?: string | null;
  daily_goal?: number;
  target_plays?: number | null;
  position?: number;
  started_at?: string | null;
  ends_at?: string | null;
  ramp_up_days?: number;
};

export type NewCuratorDealInput = {
  curator_name: string;
  // música primária (legacy/compat) — primeira da lista
  song_spotify_url: string;
  song_name: string;
  song_artist?: string | null;
  song_cover_url?: string | null;
  target_plays: number;
  daily_goal?: number;
  baseline_plays?: number;
  cost?: number | null;
  started_at?: string | null;
  ends_at?: string | null;
  ramp_up_days?: number;
  // lista de músicas adicionais (além da primária)
  extra_songs?: DealSongInput[];
};

export type NewCuratorLogInput = {
  deal_id: string;
  total_plays: number;
  note?: string | null;
  is_baseline?: boolean;
  print_urls?: string[];
  song_id?: string | null;
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
  const [songs, setSongs] = useState<CuratorDealSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setDeals([]);
      setLogs([]);
      setPlaylists([]);
      setSongs([]);
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
        setSongs([]);
      } else {
        const [logsRes, plRes, songsRes] = await Promise.all([
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
          supabase
            .from("curator_deal_songs")
            .select("*")
            .in("deal_id", dealIds)
            .order("position", { ascending: true }),
        ]);
        if (logsRes.error) throw logsRes.error;
        if (plRes.error) throw plRes.error;
        if (songsRes.error) throw songsRes.error;
        setLogs((logsRes.data ?? []) as CuratorDealLog[]);
        setPlaylists((plRes.data ?? []) as CuratorPlaylist[]);
        setSongs((songsRes.data ?? []) as CuratorDealSong[]);
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
          daily_goal: input.daily_goal ?? 0,
          baseline_plays: input.baseline_plays ?? 0,
          cost: input.cost ?? null,
          started_at: input.started_at ?? new Date().toISOString(),
          ends_at: input.ends_at ?? null,
          ramp_up_days: input.ramp_up_days ?? 5,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      const deal = data as CuratorDeal;

      // Sempre cria a primeira música em curator_deal_songs
      const primarySong: DealSongInput = {
        song_spotify_url: input.song_spotify_url,
        song_name: input.song_name,
        song_artist: input.song_artist ?? null,
        song_cover_url: input.song_cover_url ?? null,
        daily_goal: input.daily_goal ?? 0,
        target_plays: input.target_plays,
        position: 0,
        started_at: input.started_at ?? null,
        ends_at: input.ends_at ?? null,
        ramp_up_days: input.ramp_up_days ?? 5,
      };
      const allSongs = [primarySong, ...(input.extra_songs ?? [])];
      const songRows = allSongs.map((s, i) => ({
        deal_id: deal.id,
        song_spotify_url: s.song_spotify_url,
        spotify_track_id: s.spotify_track_id ?? null,
        song_name: s.song_name,
        song_artist: s.song_artist ?? null,
        song_cover_url: s.song_cover_url ?? null,
        daily_goal: s.daily_goal ?? 0,
        target_plays: s.target_plays ?? null,
        position: s.position ?? i,
        started_at: s.started_at ?? null,
        ends_at: s.ends_at ?? null,
        ramp_up_days: s.ramp_up_days ?? input.ramp_up_days ?? 5,
      }));
      const { error: songsErr } = await supabase
        .from("curator_deal_songs")
        .insert(songRows);
      if (songsErr) throw songsErr;

      await load();
      return deal;
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

  const updateDeal = useCallback(
    async (dealId: string, input: NewCuratorDealInput) => {
      // 1) Atualiza o registro principal (deal) — campos legacy + janela
      const { error: updErr } = await supabase
        .from("curator_deals")
        .update({
          curator_name: input.curator_name,
          song_spotify_url: input.song_spotify_url,
          song_name: input.song_name,
          song_artist: input.song_artist ?? null,
          song_cover_url: input.song_cover_url ?? null,
          target_plays: input.target_plays,
          daily_goal: input.daily_goal ?? 0,
          cost: input.cost ?? null,
          started_at: input.started_at ?? new Date().toISOString(),
          ends_at: input.ends_at ?? null,
          ramp_up_days: input.ramp_up_days ?? 5,
        })
        .eq("id", dealId);
      if (updErr) throw updErr;

      // 2) Substitui a lista de músicas (delete + insert) — mais simples e robusto
      const { error: delSongsErr } = await supabase
        .from("curator_deal_songs")
        .delete()
        .eq("deal_id", dealId);
      if (delSongsErr) throw delSongsErr;

      const primarySong: DealSongInput = {
        song_spotify_url: input.song_spotify_url,
        song_name: input.song_name,
        song_artist: input.song_artist ?? null,
        song_cover_url: input.song_cover_url ?? null,
        daily_goal: input.daily_goal ?? 0,
        target_plays: input.target_plays,
        position: 0,
        started_at: input.started_at ?? null,
        ends_at: input.ends_at ?? null,
        ramp_up_days: input.ramp_up_days ?? 5,
      };
      const allSongs = [primarySong, ...(input.extra_songs ?? [])];
      const songRows = allSongs.map((s, i) => ({
        deal_id: dealId,
        song_spotify_url: s.song_spotify_url,
        spotify_track_id: s.spotify_track_id ?? null,
        song_name: s.song_name,
        song_artist: s.song_artist ?? null,
        song_cover_url: s.song_cover_url ?? null,
        daily_goal: s.daily_goal ?? 0,
        target_plays: s.target_plays ?? null,
        position: s.position ?? i,
        started_at: s.started_at ?? null,
        ends_at: s.ends_at ?? null,
        ramp_up_days: s.ramp_up_days ?? input.ramp_up_days ?? 5,
      }));
      const { error: songsErr } = await supabase
        .from("curator_deal_songs")
        .insert(songRows);
      if (songsErr) throw songsErr;

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
    songs,
    loading,
    error,
    addDeal,
    deleteDeal,
    addLog,
    addBaseline,
    reload: load,
  };
}
