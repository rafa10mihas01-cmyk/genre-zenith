// useCuratorDeals — camada de dados do módulo redesenhado de Curator Deals.
// Mesmo padrão dos demais hooks: SDK Supabase direto em useEffect/useCallback.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type {
  CuratorDeal,
  CuratorDealLog,
  CuratorPlaylist,
  CuratorDealSong,
  CuratorDealProgress,
} from "@/lib/curatorDealsUtils";

export type CuratorFraudAlert = {
  id: string;
  deal_id: string;
  playlist_id: string | null;
  alert_type: string;
  severity: "low" | "medium" | "high" | string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  status: "open" | "acknowledged" | "resolved" | string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
};

// ============================================================
// FASE 1 — Curador global (entidade) + saldo
// ============================================================
export type Curator = {
  id: string;
  user_id: string;
  name: string;
  contact: string | null;
  spotify_owner_id: string | null;
  spotify_owner_url: string | null;
  purchased_plays: number;
  total_cost: number | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CuratorBalance = {
  curator_id: string;
  user_id: string;
  name: string;
  archived_at: string | null;
  purchased_plays: number;
  consumed_plays: number;
  remaining_plays: number;
  overbooked_plays: number;
  total_cost: number | null;
};

export type NewCuratorInput = {
  name: string;
  contact?: string | null;
  spotify_owner_id?: string | null;
  spotify_owner_url?: string | null;
  purchased_plays?: number;
  total_cost?: number | null;
  notes?: string | null;
};

export type DealSongInput = {
  song_spotify_url: string;
  spotify_track_id?: string | null;
  song_name: string;
  song_artist?: string | null;
  song_cover_url?: string | null;
  daily_goal?: number;
  duration_days?: number;
  target_plays?: number | null;
  position?: number;
  started_at?: string | null;
  ends_at?: string | null;
  ramp_up_days?: number;
};

export type NewCuratorDealInput = {
  // FASE 1: curador agora é entidade. Mantemos curator_name por compat (legacy).
  curator_id?: string | null;
  curator_name: string;
  // música primária (legacy/compat) — primeira da lista
  song_spotify_url: string;
  song_name: string;
  song_artist?: string | null;
  song_cover_url?: string | null;
  target_plays: number;
  daily_goal?: number;
  duration_days?: number;
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
  const queryClient = useQueryClient();
  const [deals, setDeals] = useState<CuratorDeal[]>([]);
  const [logs, setLogs] = useState<CuratorDealLog[]>([]);
  const [playlists, setPlaylists] = useState<CuratorPlaylist[]>([]);
  const [songs, setSongs] = useState<CuratorDealSong[]>([]);
  const [alerts, setAlerts] = useState<CuratorFraudAlert[]>([]);
  const [curators, setCurators] = useState<Curator[]>([]);
  const [balances, setBalances] = useState<CuratorBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setDeals([]);
      setLogs([]);
      setPlaylists([]);
      setSongs([]);
      setAlerts([]);
      setCurators([]);
      setBalances([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Curadores + saldos em paralelo com deals
      const [dealsRes, curatorsRes, balancesRes] = await Promise.all([
        supabase
          .from("curator_deals")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("curators")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("v_curator_balance")
          .select("*"),
      ]);
      if (dealsRes.error) throw dealsRes.error;
      if (curatorsRes.error) throw curatorsRes.error;
      if (balancesRes.error) throw balancesRes.error;

      const dealsRows = (dealsRes.data ?? []) as CuratorDeal[];
      setDeals(dealsRows);
      setCurators((curatorsRes.data ?? []) as Curator[]);
      setBalances((balancesRes.data ?? []) as CuratorBalance[]);

      const dealIds = dealsRows.map((d) => d.id);
      if (dealIds.length === 0) {
        setLogs([]);
        setPlaylists([]);
        setSongs([]);
        setAlerts([]);
      } else {
        const [logsRes, plRes, songsRes, alertsRes] = await Promise.all([
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
          supabase
            .from("curator_fraud_alerts")
            .select("*")
            .in("deal_id", dealIds)
            .eq("status", "open")
            .order("created_at", { ascending: false }),
        ]);
        if (logsRes.error) throw logsRes.error;
        if (plRes.error) throw plRes.error;
        if (songsRes.error) throw songsRes.error;
        if (alertsRes.error) throw alertsRes.error;
        setLogs((logsRes.data ?? []) as CuratorDealLog[]);
        setPlaylists((plRes.data ?? []) as CuratorPlaylist[]);
        setSongs((songsRes.data ?? []) as CuratorDealSong[]);
        setAlerts((alertsRes.data ?? []) as CuratorFraudAlert[]);
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

  // ============================================================
  // FASE 6 — Progresso via TanStack Query (cache + realtime)
  // ============================================================
  const dealIds = useMemo(() => deals.map((d) => d.id), [deals]);

  const progressQueries = useQueries({
    queries: dealIds.map((id) => ({
      queryKey: ["curator-progress", id] as const,
      queryFn: async (): Promise<CuratorDealProgress | null> => {
        const { data, error: rpcErr } = await supabase.rpc(
          "get_curator_deal_progress",
          { p_deal_id: id },
        );
        if (rpcErr) throw rpcErr;
        return (data ?? null) as CuratorDealProgress | null;
      },
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
  });

  const progressByDeal = useMemo(() => {
    const map: Record<string, CuratorDealProgress> = {};
    progressQueries.forEach((q, i) => {
      const id = dealIds[i];
      if (id && q.data) map[id] = q.data as CuratorDealProgress;
    });
    return map;
  }, [progressQueries, dealIds]);

  // Realtime: invalida cache quando snapshots mudam
  useEffect(() => {
    if (!user || dealIds.length === 0) return;
    const channel = supabase
      .channel(`curator-snapshots-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deal_snapshots" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { deal_id?: string } | null;
          const dealId = row?.deal_id;
          if (dealId && dealIds.includes(dealId)) {
            queryClient.invalidateQueries({ queryKey: ["curator-progress", dealId] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, dealIds, queryClient]);

  const invalidateProgress = useCallback(
    (dealId?: string) => {
      if (dealId) {
        queryClient.invalidateQueries({ queryKey: ["curator-progress", dealId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["curator-progress"] });
      }
    },
    [queryClient],
  );

  // ============================================================
  // FASE 1 — CRUD de Curadores (entidade global)
  // ============================================================
  const addCurator = useCallback(
    async (input: NewCuratorInput) => {
      if (!user) throw new Error("Usuário não autenticado");
      const { data, error: insertErr } = await supabase
        .from("curators")
        .insert({
          user_id: user.id,
          name: input.name,
          contact: input.contact ?? null,
          spotify_owner_id: input.spotify_owner_id ?? null,
          spotify_owner_url: input.spotify_owner_url ?? null,
          purchased_plays: input.purchased_plays ?? 0,
          total_cost: input.total_cost ?? 0,
          notes: input.notes ?? null,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;
      await load();
      return data as Curator;
    },
    [user, load],
  );

  const updateCurator = useCallback(
    async (curatorId: string, input: Partial<NewCuratorInput>) => {
      const { error: updErr } = await supabase
        .from("curators")
        .update({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.contact !== undefined && { contact: input.contact ?? null }),
          ...(input.spotify_owner_id !== undefined && { spotify_owner_id: input.spotify_owner_id ?? null }),
          ...(input.spotify_owner_url !== undefined && { spotify_owner_url: input.spotify_owner_url ?? null }),
          ...(input.purchased_plays !== undefined && { purchased_plays: input.purchased_plays }),
          ...(input.total_cost !== undefined && { total_cost: input.total_cost ?? 0 }),
          ...(input.notes !== undefined && { notes: input.notes ?? null }),
        })
        .eq("id", curatorId);
      if (updErr) throw updErr;
      await load();
    },
    [load],
  );

  const archiveCurator = useCallback(
    async (curatorId: string, archive = true) => {
      const { error: updErr } = await supabase
        .from("curators")
        .update({ archived_at: archive ? new Date().toISOString() : null })
        .eq("id", curatorId);
      if (updErr) throw updErr;
      await load();
    },
    [load],
  );

  const deleteCurator = useCallback(
    async (curatorId: string) => {
      const { error: delErr } = await supabase
        .from("curators")
        .delete()
        .eq("id", curatorId);
      if (delErr) throw delErr;
      await load();
    },
    [load],
  );

  // ============================================================
  // Deals — agora aceitam curator_id e duration_days nas songs
  // ============================================================
  const addDeal = useCallback(
    async (input: NewCuratorDealInput) => {
      if (!user) throw new Error("Usuário não autenticado");
      const { data, error: insertErr } = await supabase
        .from("curator_deals")
        .insert({
          user_id: user.id,
          curator_id: input.curator_id ?? null,
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
        duration_days: input.duration_days ?? 30,
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
        duration_days: s.duration_days ?? 30,
        target_plays: s.target_plays ?? null,
        position: s.position ?? i,
        started_at: s.started_at ?? null,
        ends_at: s.ends_at ?? null,
        ramp_up_days: s.ramp_up_days ?? input.ramp_up_days ?? 5,
        // Auto-coleta de baseline: bot pega na próxima rodada (~1-2 min)
        auto_collect: true,
        auto_collect_status: "idle",
        auto_collect_interval_minutes: 1440, // 1x/dia depois do baseline
        next_auto_collect_at: new Date().toISOString(),
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
          curator_id: input.curator_id ?? null,
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
        duration_days: input.duration_days ?? 30,
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
        duration_days: s.duration_days ?? 30,
        target_plays: s.target_plays ?? null,
        position: s.position ?? i,
        started_at: s.started_at ?? null,
        ends_at: s.ends_at ?? null,
        ramp_up_days: s.ramp_up_days ?? input.ramp_up_days ?? 5,
        auto_collect: true,
        auto_collect_status: "idle",
        auto_collect_interval_minutes: 1440,
        next_auto_collect_at: new Date().toISOString(),
      }));
      const { error: songsErr } = await supabase
        .from("curator_deal_songs")
        .insert(songRows);
      if (songsErr) throw songsErr;

      await load();
    },
    [load],
  );

  // ============================================================
  // Snapshots — fonte única de verdade (Spotify for Artists)
  // O log agregado é mantido pra histórico de UI; o cálculo real
  // de entrega passa a vir de curator_deal_snapshots (uma linha
  // por playlist por print).
  // ============================================================
  type SnapshotMatch = {
    playlist_id: string;
    plays: number;
    confidence?: number | null;
  };

  const insertSnapshots = useCallback(
    async (
      dealId: string,
      songId: string | null,
      matches: SnapshotMatch[],
      opts: { isBaseline: boolean; printUrl?: string | null; capturedAt?: string },
    ) => {
      if (!matches.length) return;
      const rows = matches.map((m) => ({
        deal_id: dealId,
        song_id: songId,
        playlist_id: m.playlist_id,
        plays: Math.max(0, Math.round(m.plays)),
        captured_at: opts.capturedAt ?? new Date().toISOString(),
        print_url: opts.printUrl ?? null,
        is_baseline: opts.isBaseline,
        source: "spotify_for_artists",
        ai_confidence: m.confidence ?? null,
        created_by: user?.id ?? null,
      }));
      const { error: snapErr } = await supabase
        .from("curator_deal_snapshots")
        .insert(rows);
      if (snapErr) throw snapErr;
    },
    [user],
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
          song_id: input.song_id ?? null,
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
      songId: string | null = null,
    ) => {
      // 1. Log baseline (mantido pra UI/histórico)
      const { error: logErr } = await supabase
        .from("curator_deal_logs")
        .insert({
          deal_id: dealId,
          total_plays: plays,
          is_baseline: true,
          note: null,
          print_urls: printUrls,
          song_id: songId,
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
          song_id: songId,
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

  const closeDeal = useCallback(
    async (
      dealId: string,
      opts: {
        status: "completed" | "cancelled";
        reason?: string | null;
        report_url?: string | null;
      },
    ) => {
      const { error: updErr } = await supabase
        .from("curator_deals")
        .update({
          closed_at: new Date().toISOString(),
          closed_status: opts.status,
          closed_reason: opts.reason ?? null,
          final_report_url: opts.report_url ?? null,
        })
        .eq("id", dealId);
      if (updErr) throw updErr;
      await load();
    },
    [load],
  );

  const reopenDeal = useCallback(
    async (dealId: string) => {
      const { error: updErr } = await supabase
        .from("curator_deals")
        .update({
          closed_at: null,
          closed_status: null,
          closed_reason: null,
        })
        .eq("id", dealId);
      if (updErr) throw updErr;
      await load();
    },
    [load],
  );

  return {
    deals,
    logs,
    playlists,
    songs,
    alerts,
    curators,
    balances,
    progressByDeal,
    loading,
    error,
    // Curadores
    addCurator,
    updateCurator,
    archiveCurator,
    deleteCurator,
    // Deals
    addDeal,
    updateDeal,
    deleteDeal,
    addLog,
    addBaseline,
    insertSnapshots,
    closeDeal,
    reopenDeal,
    reload: load,
    invalidateProgress,
  };
}
