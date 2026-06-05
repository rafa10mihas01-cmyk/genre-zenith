// useCampaigns — React Query + realtime + mutações otimistas para /campanhas.
import { useCallback, useEffect, useId } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type Campaign = {
  id: string;
  track_name: string;
  artist: string | null;
  cover_url: string | null;
  goal_plays: number;
  deadline: string;
  status: "draft" | "active" | "paused" | "completed" | "cancelled";
  total_allocated: number;
  total_delivered: number;
  created_at: string;
  snapshot_locked_at: string | null;
  client_id: string | null;
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
  /** Valor total cobrado do cliente (base pro CPP). */
  valor_cobrado?: number | null;
  /** @deprecated mantido só pra compat de tipos durante reversão 30/05. Sempre false. */
  baseline_pending?: boolean;
  /** Derivado: timestamp da 1ª baseline capturada (qualquer deal da campanha). */
  baseline_captured_at?: string | null;
  /** Derivado: e-mail principal do cliente vinculado (se houver). */
  client_email?: string | null;
  /** Derivado: nº de e-mails autorizados a acessar o portal desta campanha. */
  access_emails_count?: number;
};

const SELECT = "id, track_name, artist, cover_url, goal_plays, deadline, status, total_allocated, total_delivered, created_at, snapshot_locked_at, client_id, curator_id, deal_id, public_plan_token, client_approved_at, client_approved_by, client_rejected_at, campaign_type, collection_mode, plan_approved_at, client_decision_round, valor_cobrado, baseline_captured_at, baseline_status";

const QUERY_KEY = ["campaigns"] as const;

export function useCampaigns() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const instanceId = useId();

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

      // Reversão 30/05: baseline deixou de ser gate. baseline_captured_at vem
      // direto de campaigns (fonte da verdade gravada por ingest_campaign_collection_batch).
      // Mantemos lookup em curator_deals só como FALLBACK pra campanhas antigas
      // onde o campo só foi preenchido no deal.
      const ids = campaigns.map((c) => c.id);
      const clientIds = Array.from(new Set(campaigns.map((c) => c.client_id).filter(Boolean) as string[]));

      const [{ data: deals }, { data: accessEmails }, { data: clients }] = await Promise.all([
        supabase.from("curator_deals").select("campaign_id, baseline_captured_at").in("campaign_id", ids),
        supabase.from("campaign_access_emails").select("campaign_id").in("campaign_id", ids),
        clientIds.length > 0
          ? supabase.from("clients").select("id, email").in("id", clientIds)
          : Promise.resolve({ data: [] as Array<{ id: string; email: string | null }> } as any),
      ]);

      const dealBaselineByCamp = new Map<string, string | null>();
      for (const d of deals ?? []) {
        const cap = d.baseline_captured_at as string | null;
        const cur = dealBaselineByCamp.get(d.campaign_id as string) ?? null;
        // Mantém a MAIS ANTIGA (primeira baseline coletada do deal).
        if (cap && (!cur || cap < cur)) dealBaselineByCamp.set(d.campaign_id as string, cap);
        else if (!dealBaselineByCamp.has(d.campaign_id as string)) dealBaselineByCamp.set(d.campaign_id as string, cur);
      }
      const accessCount = new Map<string, number>();
      for (const a of accessEmails ?? []) {
        const k = a.campaign_id as string;
        accessCount.set(k, (accessCount.get(k) ?? 0) + 1);
      }
      const clientEmailById = new Map<string, string | null>();
      for (const cl of (clients ?? []) as Array<{ id: string; email: string | null }>) {
        clientEmailById.set(cl.id, cl.email ?? null);
      }

      return campaigns.map((c) => ({
        ...c,
        baseline_pending: false,
        // Prioridade: valor da própria campaign > fallback do deal.
        baseline_captured_at: (c as any).baseline_captured_at ?? dealBaselineByCamp.get(c.id) ?? null,
        access_emails_count: accessCount.get(c.id) ?? 0,
        client_email: c.client_id ? clientEmailById.get(c.client_id) ?? null : null,
      }));
    },
  });



  // Realtime: qualquer mudança em campaigns OU curator_deals (baseline) invalida.
  useEffect(() => {
    if (!user) return;
    const topic = `campaigns-live-${user.id}-${instanceId.replace(/:/g, "")}`;
    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaigns" },
        () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deals" },
        () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaign_access_emails" },
        () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc, instanceId]);

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
