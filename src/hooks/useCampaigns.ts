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
  plan_approved_at: string | null;
  client_decision_round: number | null;
};

const SELECT = "id, track_name, artist, goal_plays, deadline, status, total_allocated, total_delivered, created_at, snapshot_locked_at, curator_id, deal_id, public_plan_token, client_approved_at, client_approved_by, client_rejected_at, campaign_type, plan_approved_at, client_decision_round";
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
      return (data ?? []) as Campaign[];
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
