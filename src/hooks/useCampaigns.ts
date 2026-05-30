// useCampaigns — React Query + realtime + mutações otimistas para /campanhas.
import { useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type Campaign = {
  id: string;
  track_name: string;
  artist: string | null;
  goal_plays: number;
  deadline: string;
  status: "draft" | "active" | "paused" | "completed" | "cancelled";
  total_allocated: number;
  total_delivered: number;
  created_at: string;
  snapshot_locked_at: string | null;
  curator_id: string | null;
  deal_id: string | null;
  public_plan_token: string | null;
  client_approved_at: string | null;
  client_approved_by: string | null;
  client_rejected_at: string | null;
  campaign_type: "ecosystem" | "external" | "hybrid" | null;
  collection_mode: "bot" | "spreadsheet" | string | null;
  plan_approved_at: string | null;
  client_decision_round: number | null;
  /** @deprecated mantido só pra compat de tipos durante reversão 30/05. Sempre false. */
  baseline_pending?: boolean;
  /** Derivado: timestamp da 1ª baseline capturada (qualquer deal da campanha). */
  baseline_captured_at?: string | null;

};

const SELECT = "id, track_name, artist, goal_plays, deadline, status, total_allocated, total_delivered, created_at, snapshot_locked_at, curator_id, deal_id, public_plan_token, client_approved_at, client_approved_by, client_rejected_at, campaign_type, collection_mode, plan_approved_at, client_decision_round";
const QUERY_KEY = ["campaigns"] as const;

export function useCampaigns() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    enabled: !!user,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select(SELECT)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const campaigns = (data ?? []) as Campaign[];
      if (campaigns.length === 0) return campaigns;

      // Enriquece com estado de baseline dos deals (1 query única).
      const ids = campaigns.map((c) => c.id);
      const { data: deals } = await supabase
        .from("curator_deals")
        .select("campaign_id, state, baseline_captured_at")
        .in("campaign_id", ids);

      const byCamp = new Map<string, { pending: boolean; captured: string | null }>();
      for (const d of deals ?? []) {
        const cur = byCamp.get(d.campaign_id as string) ?? { pending: false, captured: null };
        if (d.state === "awaiting_baseline") cur.pending = true;
        if (d.baseline_captured_at && (!cur.captured || d.baseline_captured_at < cur.captured)) {
          cur.captured = d.baseline_captured_at as string;
        }
        byCamp.set(d.campaign_id as string, cur);
      }
      return campaigns.map((c) => {
        const meta = byCamp.get(c.id);
        return {
          ...c,
          baseline_pending: meta?.pending ?? false,
          baseline_captured_at: meta?.captured ?? null,
        };
      });
    },
  });

  // Realtime: qualquer mudança em campaigns invalida.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`campaigns-live-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaigns" },
        () => {
          qc.invalidateQueries({ queryKey: QUERY_KEY });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc]);

  // Update status (active/paused/cancelled etc) — otimista
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Campaign["status"] }) => {
      const { error } = await supabase.from("campaigns").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const previous = qc.getQueryData<Campaign[]>(QUERY_KEY);
      qc.setQueryData<Campaign[]>(QUERY_KEY, (prev) =>
        (prev ?? []).map((c) => (c.id === id ? { ...c, status } : c)),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUERY_KEY, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  // Delete — otimista
  const removeCampaign = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("campaigns").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const previous = qc.getQueryData<Campaign[]>(QUERY_KEY);
      qc.setQueryData<Campaign[]>(QUERY_KEY, (prev) => (prev ?? []).filter((c) => c.id !== id));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUERY_KEY, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  // Approve — RPC; depende do servidor, sem otimismo mas invalida tudo
  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase.rpc as any)("approve_campaign", { p_campaign_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      // novo deal real foi criado
      qc.invalidateQueries({ queryKey: ["curator-deals"] });
    },
  });

  // Recalc — invalida ao fim
  const recalcAll = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("recalc_campaign_progress", { p_campaign_id: null });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: QUERY_KEY });
  }, [qc]);

  return {
    items: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
    refresh,
    updateStatus,
    removeCampaign,
    approve,
    recalcAll,
  };
}
