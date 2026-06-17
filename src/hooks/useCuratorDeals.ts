// useCuratorDeals — camada de dados do módulo redesenhado de Curator Deals.
// Mesmo padrão dos demais hooks: SDK Supabase direto em useEffect/useCallback.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueries, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
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

// Extrai o track_id de qualquer URL/URI do Spotify (open.spotify.com/.../track/<id>, intl-pt, spotify:track:<id>)
function extractSpotifyTrackIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/track[/:]([a-zA-Z0-9]{16,})/);
  return m ? m[1] : null;
}

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
  paused_at: string | null;
  created_at: string;
  updated_at: string;
  deal_type: "avulso" | "mensal";
  default_amount: number | null;
  default_plays: number | null;
  monthly_amount: number | null;
  billing_day: number | null;
  phone: string | null;
  email: string | null;
  pix_key: string | null;
  pix_type: string | null;
  full_name: string | null;
  document: string | null;
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
  deal_type?: "avulso" | "mensal";
  default_amount?: number | null;
  default_plays?: number | null;
  monthly_amount?: number | null;
  billing_day?: number | null;
  phone?: string | null;
  email?: string | null;
  pix_key?: string | null;
  pix_type?: string | null;
  full_name?: string | null;
  document?: string | null;
};

export type DealSongInput = {
  song_spotify_url: string;
  spotify_track_id?: string | null;
  song_name: string;
  song_artist?: string | null;
  artist_candidates?: string[];
  song_cover_url?: string | null;
  daily_goal?: number;
  duration_days?: number;
  target_plays?: number | null;
  position?: number;
  started_at?: string | null;
  ends_at?: string | null;
  ramp_up_days?: number;
  client_id?: string | null;
  smartlink_url?: string | null;
};

export type NewCuratorDealInput = {
  curator_id?: string | null;
  curator_name: string;
  song_spotify_url: string;
  song_name: string;
  song_artist?: string | null;
  artist_candidates?: string[];
  song_cover_url?: string | null;
  client_id?: string | null;
  smartlink_url?: string | null;
  target_plays: number;
  daily_goal?: number;
  duration_days?: number;
  baseline_plays?: number;
  cost?: number | null;
  started_at?: string | null;
  ends_at?: string | null;
  ramp_up_days?: number;
  extra_songs?: DealSongInput[];
  // Modelo de cobrança
  billing_model?: "per_streams" | "monthly_retainer";
  monthly_amount?: number | null;
  cycle_months?: number | null;
  // Vínculo com a campanha de origem (quando o deal é criado a partir de uma campanha)
  campaign_id?: string | null;
};

export type NewCuratorLogInput = {
  deal_id: string;
  total_plays: number;
  note?: string | null;
  is_initial_capture_event?: boolean;
  print_urls?: string[];
  song_id?: string | null;
};

export type BaselinePlaylistInput = {
  spotify_url: string;
  playlist_name: string;
  followers?: number | null;
};

export function useCuratorDeals(opts?: { includeInternal?: boolean }) {
  const includeInternal = opts?.includeInternal ?? false;
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () => ["curator-deals", user?.id ?? "anon", includeInternal] as const,
    [user?.id, includeInternal],
  );

  type CuratorDealsBundle = {
    deals: CuratorDeal[];
    logs: CuratorDealLog[];
    playlists: CuratorPlaylist[];
    songs: CuratorDealSong[];
    alerts: CuratorFraudAlert[];
    curators: Curator[];
    balances: CuratorBalance[];
  };

  const emptyBundle: CuratorDealsBundle = {
    deals: [], logs: [], playlists: [], songs: [], alerts: [], curators: [], balances: [],
  };

  const query = useQuery<CuratorDealsBundle>({
    queryKey,
    enabled: !!user,
    staleTime: 30_000,
    gcTime: 600_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // Curadores + saldos em paralelo com deals
      const [dealsRes, curatorsRes, balancesRes] = await Promise.all([
        (() => {
          let q = supabase
            .from("curator_deals")
            .select("*");
          if (!includeInternal) {
            q = q.or("source.is.null,source.neq.campaign_internal");
          }
          return q.order("created_at", { ascending: false }).limit(1000);
        })(),
        supabase
          .from("curators")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase
          .from("v_curator_balance")
          .select("*")
          .limit(2000),
      ]);
      if (dealsRes.error) throw dealsRes.error;
      if (curatorsRes.error) throw curatorsRes.error;
      if (balancesRes.error) throw balancesRes.error;

      const dealsRows = (dealsRes.data ?? []) as CuratorDeal[];
      const curatorsRows = (curatorsRes.data ?? []) as Curator[];
      const balancesRows = (balancesRes.data ?? []) as CuratorBalance[];

      const dealIds = dealsRows.map((d) => d.id);
      if (dealIds.length === 0) {
        return {
          deals: dealsRows,
          logs: [], playlists: [], songs: [], alerts: [],
          curators: curatorsRows,
          balances: balancesRows,
        };
      }

      const [logsRes, plRes, songsRes, alertsRes] = await Promise.all([
        supabase
          .from("curator_deal_logs")
          .select("*")
          .in("deal_id", dealIds)
          .order("created_at", { ascending: true })
          .limit(5000),
        supabase
          // Separação operacional × observacional: hub interno usa apenas curadoria entregue
          .from("v_curator_playlists_operational")
          .select("*")
          .in("deal_id", dealIds)
          .order("added_at", { ascending: true })
          .limit(5000),
        supabase
          .from("curator_deal_songs")
          .select("*")
          .in("deal_id", dealIds)
          .order("position", { ascending: true })
          .limit(5000),
        supabase
          .from("curator_fraud_alerts")
          .select("*")
          .in("deal_id", dealIds)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (logsRes.error) throw logsRes.error;
      if (plRes.error) throw plRes.error;
      if (songsRes.error) throw songsRes.error;
      if (alertsRes.error) throw alertsRes.error;

      return {
        deals: dealsRows,
        logs: (logsRes.data ?? []) as CuratorDealLog[],
        playlists: ((plRes.data ?? []) as CuratorPlaylist[]).map((p) => ({
          ...p,
          match_status: (p.match_status as string) === "algorithmic" ? "editorial" : p.match_status,
        })) as CuratorPlaylist[],
        songs: (songsRes.data ?? []) as CuratorDealSong[],
        alerts: (alertsRes.data ?? []) as CuratorFraudAlert[],
        curators: curatorsRows,
        balances: balancesRows,
      };
    },
  });

  const bundle = query.data ?? emptyBundle;
  const { deals, logs, playlists, songs, alerts, curators, balances } = bundle;
  // `loading` mantém contrato: true só quando NÃO há dado em cache (1ª visita).
  const loading = query.isLoading && !query.data;
  const error = query.error ? (query.error instanceof Error ? query.error.message : String(query.error)) : null;

  const load = useCallback(async () => {
    await query.refetch();
  }, [query]);

  // Polling de fallback: enquanto houver música em coleta ativa (queued/collecting),
  // revalida a cada 5s para garantir que o status volte para "idle" mesmo
  // que o evento realtime seja perdido.
  const hasActiveCollection = useMemo(
    () =>
      songs.some(
        (s) =>
          s.auto_collect_status === "queued" ||
          s.auto_collect_status === "collecting",
      ),
    [songs],
  );
  useEffect(() => {
    if (!hasActiveCollection) return;
    const id = setInterval(() => {
      queryClient.invalidateQueries({ queryKey });
    }, 5000);
    return () => clearInterval(id);
  }, [hasActiveCollection, queryClient, queryKey]);

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

  // Enriquecimento: pra deals vinculados a campanhas, somar a entrega real
  // direto da vw_campaign_playlist_growth (mesma fonte usada pela lista de
  // campanhas e pela tela de execução). Sobrescreve daily_avg / today / delivered
  // quando o RPC retorna zero mas o view tem dados.
  const campaignDealRefs = useMemo(
    () => deals
      .filter((d) => !!d.campaign_id && !!d.curator_id)
      .map((d) => ({ deal_id: d.id, campaign_id: d.campaign_id as string, curator_id: d.curator_id as string, started_at: d.started_at })),
    [deals],
  );
  const campaignIdsForView = useMemo(
    () => Array.from(new Set(campaignDealRefs.map((r) => r.campaign_id))),
    [campaignDealRefs],
  );

  const viewProgressQuery = useQuery({
    queryKey: ["curator-deal-view-progress", campaignIdsForView.sort().join(",")],
    enabled: campaignIdsForView.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      // Growth Engine: vw_campaign_playlist_growth expõe `attributed_to` como
      // texto ('curator:<uuid>' | 'ecosystem' | 'organic'). A coluna
      // `attributed_curator_id` NÃO existe — parsing manual.
      const { data, error } = await (supabase as any)
        .from("vw_campaign_playlist_growth")
        .select("campaign_id, attributed_to, delta, last_captured_at")
        .in("campaign_id", campaignIdsForView);
      if (error) throw error;
      return (data ?? []) as Array<{
        campaign_id: string;
        attributed_to: string | null;
        delta: number | null;
        last_captured_at: string | null;
      }>;
    },
  });

  const viewProgressByDeal = useMemo(() => {
    const rows = viewProgressQuery.data ?? [];
    type Agg = { delivered: number; today: number };
    const agg = new Map<string, Agg>();
    const todayKey = new Date().toISOString().slice(0, 10);
    for (const r of rows) {
      const at = r.attributed_to ?? "";
      if (!at.startsWith("curator:")) continue;
      const curatorId = at.slice("curator:".length);
      if (!curatorId) continue;
      const k = `${r.campaign_id}:${curatorId}`;
      const cur = agg.get(k) ?? { delivered: 0, today: 0 };
      const delta = Number(r.delta ?? 0);
      cur.delivered += delta;
      if (r.last_captured_at && r.last_captured_at.slice(0, 10) === todayKey) {
        cur.today += delta;
      }
      agg.set(k, cur);
    }
    const out: Record<string, { delivered: number; today: number; daily_avg: number }> = {};
    for (const ref of campaignDealRefs) {
      const k = `${ref.campaign_id}:${ref.curator_id}`;
      const a = agg.get(k);
      if (!a) continue;
      const startedMs = new Date(ref.started_at).getTime();
      const days = Math.max(1, (Date.now() - startedMs) / 86_400_000);
      out[ref.deal_id] = {
        delivered: a.delivered,
        today: a.today,
        daily_avg: a.delivered / days,
      };
    }
    return out;
  }, [viewProgressQuery.data, campaignDealRefs]);

  const progressByDeal = useMemo(() => {
    const map: Record<string, CuratorDealProgress> = {};
    progressQueries.forEach((q, i) => {
      const id = dealIds[i];
      if (!id) return;
      const rpc = (q.data ?? null) as CuratorDealProgress | null;
      const viewP = viewProgressByDeal[id];
      // Se o view tem dado real, ele tem prioridade sobre o RPC zerado.
      if (viewP && viewP.delivered > 0 && (!rpc || Number(rpc.delivered_curator ?? 0) === 0)) {
        map[id] = {
          ...(rpc ?? {}),
          delivered_curator: viewP.delivered,
          delivered_total: viewP.delivered,
          daily_avg: viewP.daily_avg,
          today_plays: viewP.today,
        } as CuratorDealProgress;
      } else if (rpc) {
        // Mesmo com RPC válido, complementa today_plays se ele não veio.
        map[id] = viewP
          ? ({ ...rpc, today_plays: rpc.today_plays ?? viewP.today } as CuratorDealProgress)
          : rpc;
      }
    });
    return map;
  }, [progressQueries, dealIds, viewProgressByDeal]);


  // Realtime: invalida cache quando snapshots mudam e recarrega status das músicas.
  // Também recarrega a lista quando deals são criados/alterados fora da tela atual
  // (ex.: separação manual de campanhas em deals independentes).
  //
  // FIX REALTIME_LEAK: `dealIds` é mantido em ref pra não disparar re-subscribe
  // a cada load(). Nome de canal determinístico (sem Math.random) pra permitir
  // dedupe no client e evitar churn de WAL listeners.
  const dealIdsRef = useRef<string[]>([]);
  useEffect(() => { dealIdsRef.current = dealIds; }, [dealIds]);

  useEffect(() => {
    if (!user) return;
    const invalidateBundle = () => queryClient.invalidateQueries({ queryKey });
    const channel = supabase
      .channel(`curator-deals-live-${user.id}-${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deals" },
        () => {
          invalidateBundle();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deal_snapshots" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { deal_id?: string } | null;
          const dealId = row?.deal_id;
          if (dealId && dealIdsRef.current.includes(dealId)) {
            queryClient.invalidateQueries({ queryKey: ["curator-progress", dealId] });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deal_songs" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { deal_id?: string } | null;
          const dealId = row?.deal_id;
          if (dealId && dealIdsRef.current.includes(dealId)) {
            queryClient.invalidateQueries({ queryKey: ["curator-progress", dealId] });
            invalidateBundle();
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deal_payments" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["financial-summary"] });
          queryClient.invalidateQueries({ queryKey: ["deal-payments"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient, queryKey]);



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
  // Cria curador. Plays/custo NÃO são gravados direto: vão via ledger (curator_purchases).
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
          notes: input.notes ?? null,
          deal_type: input.deal_type ?? 'avulso',
          default_amount: input.default_amount ?? null,
          default_plays: input.default_plays ?? null,
          monthly_amount: input.monthly_amount ?? null,
          billing_day: input.billing_day ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          pix_key: input.pix_key ?? null,
          pix_type: input.pix_type ?? null,
          full_name: input.full_name ?? null,
          document: input.document ?? null,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      // Saldo inicial vai como compra no ledger (single source of truth).
      const initialPlays = Math.max(0, Number(input.purchased_plays ?? 0));
      const initialCost = Math.max(0, Number(input.total_cost ?? 0));
      if (initialPlays > 0 || initialCost > 0) {
        await supabase.from("curator_purchases").insert({
          user_id: user.id,
          curator_id: (data as Curator).id,
          plays_purchased: initialPlays,
          amount: initialCost,
          note: "saldo inicial",
        });
      }
      await load();
      return data as Curator;
    },
    [user, load],
  );

  // Atualiza apenas metadados do curador. Plays/custo são derivados do ledger.
  const updateCurator = useCallback(
    async (curatorId: string, input: Partial<NewCuratorInput>) => {
      const { error: updErr } = await supabase
        .from("curators")
        .update({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.contact !== undefined && { contact: input.contact ?? null }),
          ...(input.spotify_owner_id !== undefined && { spotify_owner_id: input.spotify_owner_id ?? null }),
          ...(input.spotify_owner_url !== undefined && { spotify_owner_url: input.spotify_owner_url ?? null }),
          ...(input.notes !== undefined && { notes: input.notes ?? null }),
          ...(input.deal_type !== undefined && { deal_type: input.deal_type }),
          ...(input.default_amount !== undefined && { default_amount: input.default_amount ?? null }),
          ...(input.default_plays !== undefined && { default_plays: input.default_plays ?? null }),
          ...(input.monthly_amount !== undefined && { monthly_amount: input.monthly_amount ?? null }),
          ...(input.billing_day !== undefined && { billing_day: input.billing_day ?? null }),
          ...(input.phone !== undefined && { phone: input.phone ?? null }),
          ...(input.email !== undefined && { email: input.email ?? null }),
          ...(input.pix_key !== undefined && { pix_key: input.pix_key ?? null }),
          ...(input.pix_type !== undefined && { pix_type: input.pix_type ?? null }),
          ...(input.full_name !== undefined && { full_name: input.full_name ?? null }),
          ...(input.document !== undefined && { document: input.document ?? null }),
        })
        .eq("id", curatorId);
      if (updErr) throw updErr;
      await load();
    },
    [load],
  );

  // Adiciona crédito (compra) ao curador. Plays/custo são derivados do ledger via trigger.
  const addCuratorPurchase = useCallback(
    async (
      curatorId: string,
      input: { plays_purchased: number; amount: number; note?: string | null },
    ) => {
      if (!user) throw new Error("Sem usuário");
      const plays = Math.max(0, Math.floor(Number(input.plays_purchased) || 0));
      const amount = Math.max(0, Number(input.amount) || 0);
      if (plays === 0 && amount === 0) {
        throw new Error("Informe plays ou valor");
      }
      const { error: insErr } = await supabase.from("curator_purchases").insert({
        user_id: user.id,
        curator_id: curatorId,
        plays_purchased: plays,
        amount,
        note: input.note?.trim() || null,
      });
      if (insErr) throw insErr;
      await load();
    },
    [user, load],
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

  // Pausar/Retomar curador: congela coleta do robô em todos os deals do curador.
  // Não mexe em saldo, financeiro, snapshots ou histórico.
  const pauseCurator = useCallback(
    async (curatorId: string, pause = true) => {
      const nowIso = new Date().toISOString();
      const { error: updErr } = await supabase
        .from("curators")
        .update({ paused_at: pause ? nowIso : null })
        .eq("id", curatorId);
      if (updErr) throw updErr;

      // Propaga para as songs vinculadas aos deals desse curador, parando a fila do robô.
      const { data: dealRows } = await supabase
        .from("curator_deals")
        .select("id")
        .eq("curator_id", curatorId);
      const dealIds = (dealRows ?? []).map((d: any) => d.id);
      if (dealIds.length) {
        await supabase
          .from("curator_deal_songs")
          .update(
            pause
              ? { auto_collect: false, auto_collect_status: "idle", auto_collect_error: "Curador pausado" }
              : { auto_collect_error: null },
          )
          .in("deal_id", dealIds);
      }
      await load();
    },
    [load],
  );

  // ============================================================
  // Deals — agora aceitam curator_id e duration_days nas songs
  // ============================================================
  const addDeal = useCallback(
    async (
      input: NewCuratorDealInput,
      opts?: {
        force?: boolean;
        new_curator?: NewCuratorInput | null;
        external_curator_id?: string | null;
      },
    ) => {
      if (!user) throw new Error("Usuário não autenticado");

      const primarySong: DealSongInput = {
        song_spotify_url: input.song_spotify_url,
        spotify_track_id: extractSpotifyTrackIdFromUrl(input.song_spotify_url),
        song_name: input.song_name,
        song_artist: input.song_artist ?? null,
        artist_candidates: input.artist_candidates ?? (input.song_artist ? [input.song_artist] : []),
        song_cover_url: input.song_cover_url ?? null,
        client_id: input.client_id ?? null,
        smartlink_url: input.smartlink_url ?? null,
        daily_goal: input.daily_goal ?? 0,
        duration_days: input.duration_days ?? 30,
        target_plays: input.target_plays,
        position: 0,
        started_at: input.started_at ?? null,
        ends_at: input.ends_at ?? null,
        ramp_up_days: input.ramp_up_days ?? 5,
      };
      const allSongs = [primarySong, ...(input.extra_songs ?? [])].map((s, i) => ({
        ...s,
        position: s.position ?? i,
        artist_candidates: s.artist_candidates ?? (s.song_artist ? [s.song_artist] : []),
      }));

      // Gap 9: quando vem de um prospect, RPC promove/cria o curador automaticamente.
      // p_external_curator_id é mutuamente exclusivo com curator_id e p_new_curator.
      const isFromProspect = !!opts?.external_curator_id;

      const dealPayload = {
        curator_id: isFromProspect ? null : (input.curator_id ?? null),
        curator_name: input.curator_name,
        baseline_plays: input.baseline_plays ?? 0,
        cost: input.cost ?? null,
        started_at: input.started_at ?? new Date().toISOString(),
        ends_at: input.ends_at ?? null,
        ramp_up_days: input.ramp_up_days ?? 5,
        billing_model: input.billing_model ?? "per_streams",
        monthly_amount: input.monthly_amount ?? null,
        cycle_months: input.cycle_months ?? null,
      };

      const { data, error: rpcErr } = await supabase.rpc(
        "create_curator_deal_atomic" as any,
        {
          p_deal: dealPayload,
          p_songs: allSongs,
          p_force: opts?.force ?? false,
          p_new_curator: isFromProspect
            ? null
            : opts?.new_curator
            ? {
                name: opts.new_curator.name,
                contact: opts.new_curator.contact ?? null,
                spotify_owner_id: opts.new_curator.spotify_owner_id ?? null,
                spotify_owner_url: opts.new_curator.spotify_owner_url ?? null,
                notes: opts.new_curator.notes ?? null,
                purchased_plays: opts.new_curator.purchased_plays ?? 0,
                total_cost: opts.new_curator.total_cost ?? 0,
              }
            : null,
          p_external_curator_id: opts?.external_curator_id ?? null,
        },
      );
      if (rpcErr) {
        // RPC agora levanta exceção em duplicate (para garantir ROLLBACK do curador novo).
        const msg = (rpcErr as any).message ?? String(rpcErr);
        if (typeof msg === "string" && msg.startsWith("DUPLICATE_DEAL")) {
          // Extrai o JSON de matches anexado à mensagem
          const jsonStart = msg.indexOf("[");
          let matches: any[] = [];
          if (jsonStart >= 0) {
            try { matches = JSON.parse(msg.slice(jsonStart)); } catch { /* ignore */ }
          }
          const err = new Error("DUPLICATE_DEAL") as Error & { matches?: any[] };
          err.matches = matches;
          throw err;
        }
        throw rpcErr;
      }

      const result = data as { ok: boolean; duplicate?: boolean; matches?: any[]; deal_id?: string };
      if (result?.duplicate && !opts?.force) {
        const err = new Error("DUPLICATE_DEAL") as Error & { matches?: any[] };
        err.matches = result.matches ?? [];
        throw err;
      }

      // Se o deal foi criado a partir de uma campanha, vincula o campaign_id
      // E garante que o bot consiga coletar:
      //  (a) ativa auto_collect=true em todas as songs do deal (default da
      //      tabela é false → sem isso, bot-collect-queue ignora o deal);
      //  (b) garante que exista pelo menos uma song com o spotify_track_id
      //      da campanha — sem song casando, snapshots não vinculam.
      if (input.campaign_id && result.deal_id) {
        const { error: linkErr } = await supabase
          .from("curator_deals")
          .update({ campaign_id: input.campaign_id } as any)
          .eq("id", result.deal_id);
        if (linkErr) {
          console.error("[addDeal] failed to link campaign_id", linkErr);
        }

        // Liga todas as songs deste deal à fila do bot
        const { error: ensureErr } = await supabase
          .from("curator_deal_songs")
          .update({
            auto_collect: true,
            auto_collect_status: "idle",
            next_auto_collect_at: new Date().toISOString(),
          } as any)
          .eq("deal_id", result.deal_id);
        if (ensureErr) {
          console.error("[addDeal] failed to enable auto_collect", ensureErr);
        }

        // Garante a song da campanha
        try {
          const { data: camp } = await supabase
            .from("campaigns")
            .select(
              "spotify_track_id, spotify_track_url, track_name, artist, cover_url, client_id",
            )
            .eq("id", input.campaign_id)
            .maybeSingle();
          const campTrackId = (camp as any)?.spotify_track_id ?? null;
          if (campTrackId) {
            const { data: existing } = await supabase
              .from("curator_deal_songs")
              .select("id")
              .eq("deal_id", result.deal_id)
              .eq("spotify_track_id", campTrackId)
              .limit(1);
            if (!existing || existing.length === 0) {
              await supabase.from("curator_deal_songs").insert({
                deal_id: result.deal_id,
                spotify_track_id: campTrackId,
                song_spotify_url: (camp as any).spotify_track_url ?? null,
                song_name: (camp as any).track_name ?? "Música",
                song_artist: (camp as any).artist ?? null,
                song_cover_url: (camp as any).cover_url ?? null,
                client_id: (camp as any).client_id ?? input.client_id ?? null,
                auto_collect: true,
                auto_collect_status: "idle",
                next_auto_collect_at: new Date().toISOString(),
              } as any);
            }
          }
        } catch (campErr) {
          console.error("[addDeal] failed to ensure campaign song", campErr);
        }
      }


      const { data: createdData, error: createdErr } = await supabase
        .from("curator_deals")
        .select("*")
        .eq("id", result.deal_id)
        .single();
      if (createdErr) throw createdErr;
      const created = createdData as CuratorDeal;
      void load();
      return created;
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
          billing_model: input.billing_model ?? "per_streams",
          monthly_amount: input.monthly_amount ?? null,
          cycle_months: input.cycle_months ?? null,
        })
        .eq("id", dealId);
      if (updErr) throw updErr;

      // 2) Sincroniza músicas SEM destruir IDs (UPDATE/INSERT/DELETE seletivo)
      //    Match por spotify_track_id; fallback por song_spotify_url normalizado.
      //    Isso preserva song_id de batches/snapshots/logs já existentes.
      const primarySong: DealSongInput = {
        song_spotify_url: input.song_spotify_url,
        spotify_track_id: extractSpotifyTrackIdFromUrl(input.song_spotify_url),
        song_name: input.song_name,
        song_artist: input.song_artist ?? null,
        artist_candidates: input.artist_candidates ?? (input.song_artist ? [input.song_artist] : []),
        song_cover_url: input.song_cover_url ?? null,
        client_id: input.client_id ?? null,
        smartlink_url: input.smartlink_url ?? null,
        daily_goal: input.daily_goal ?? 0,
        duration_days: input.duration_days ?? 30,
        target_plays: input.target_plays,
        position: 0,
        started_at: input.started_at ?? null,
        ends_at: input.ends_at ?? null,
        ramp_up_days: input.ramp_up_days ?? 5,
      };
      const desiredSongs = [primarySong, ...(input.extra_songs ?? [])].map((s, i) => ({
        ...s,
        position: s.position ?? i,
        spotify_track_id: s.spotify_track_id ?? extractSpotifyTrackIdFromUrl(s.song_spotify_url),
      }));

      const { data: existingSongsData, error: existingErr } = await supabase
        .from("curator_deal_songs")
        .select("id, spotify_track_id, song_spotify_url")
        .eq("deal_id", dealId);
      if (existingErr) throw existingErr;
      const existing = (existingSongsData ?? []) as Array<{ id: string; spotify_track_id: string | null; song_spotify_url: string }>;

      const findMatch = (s: typeof desiredSongs[number]) =>
        existing.find((e) =>
          (s.spotify_track_id && e.spotify_track_id && e.spotify_track_id === s.spotify_track_id) ||
          (e.song_spotify_url && s.song_spotify_url && e.song_spotify_url === s.song_spotify_url),
        );

      const matchedExistingIds = new Set<string>();
      const toUpdate: Array<{ id: string; row: any }> = [];
      const toInsert: any[] = [];

      desiredSongs.forEach((s, i) => {
        const baseRow = {
          deal_id: dealId,
          song_spotify_url: s.song_spotify_url,
          spotify_track_id: s.spotify_track_id ?? null,
          song_name: s.song_name,
          song_artist: s.song_artist ?? null,
          artist_candidates: s.artist_candidates ?? (s.song_artist ? [s.song_artist] : []),
          song_cover_url: s.song_cover_url ?? null,
          client_id: s.client_id ?? null,
          smartlink_url: s.smartlink_url ?? null,
          daily_goal: s.daily_goal ?? 0,
          duration_days: s.duration_days ?? 30,
          target_plays: s.target_plays ?? null,
          position: s.position ?? i,
          started_at: s.started_at ?? null,
          ends_at: s.ends_at ?? null,
          ramp_up_days: s.ramp_up_days ?? input.ramp_up_days ?? 5,
        };
        const match = findMatch(s);
        if (match && !matchedExistingIds.has(match.id)) {
          matchedExistingIds.add(match.id);
          toUpdate.push({ id: match.id, row: baseRow });
        } else {
          toInsert.push({
            ...baseRow,
            auto_collect: true,
            auto_collect_status: "idle",
            auto_collect_interval_minutes: 2880,
            next_auto_collect_at: new Date().toISOString(),
          });
        }
      });

      const toDeleteIds = existing
        .filter((e) => !matchedExistingIds.has(e.id))
        .map((e) => e.id);

      // UPDATE preserva IDs (e portanto histórico vinculado)
      for (const { id, row } of toUpdate) {
        const { error: upErr } = await supabase
          .from("curator_deal_songs")
          .update(row)
          .eq("id", id);
        if (upErr) throw upErr;
      }
      if (toInsert.length > 0) {
        const { error: insErr } = await supabase
          .from("curator_deal_songs")
          .insert(toInsert);
        if (insErr) throw insErr;
      }
      if (toDeleteIds.length > 0) {
        const { error: delErr2 } = await supabase
          .from("curator_deal_songs")
          .delete()
          .in("id", toDeleteIds);
        if (delErr2) throw delErr2;
      }

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
        is_initial_capture: opts.isBaseline,
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
          is_initial_capture_event: input.is_initial_capture_event ?? false,
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
          is_initial_capture_event: true,
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
          is_initial_roster: true,
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

  const forceCollectNow = useCallback(
    async (dealId: string) => {
      const { error: updErr } = await supabase
        .from("curator_deal_songs")
        .update({
          auto_collect: true,
          auto_collect_status: "idle",
          next_auto_collect_at: new Date().toISOString(),
        })
        .eq("deal_id", dealId);
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
    addCuratorPurchase,
    archiveCurator,
    deleteCurator,
    pauseCurator,
    // Deals
    addDeal,
    updateDeal,
    deleteDeal,
    addLog,
    addBaseline,
    insertSnapshots,
    closeDeal,
    reopenDeal,
    forceCollectNow,
    reload: load,
    invalidateProgress,
  };
}
