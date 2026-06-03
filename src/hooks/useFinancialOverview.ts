// useFinancialOverview — React Query + realtime (via useCuratorDeals channel).
import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type FinancialSummaryRow = {
  campaign_id: string;
  track_name: string | null;
  artist: string | null;
  campaign_status: string | null;
  valor_cobrado: number | null;
  valor_recebido: number | null;
  receita_pendente: number;
  total_pago_curadores: number;
  margem_bruta: number;
  margem_pct: number | null;
  num_deals: number;
  created_at: string | null;
};

export type DealPayment = {
  id: string;
  deal_id: string;
  amount: number;
  payment_date: string;
  method: string | null;
  notes: string | null;
  created_at: string;
};

export type DealFinanceRow = {
  deal_id: string;
  campaign_id: string | null;
  curator_id: string | null;
  curator_name: string;
  song_name: string;
  target_plays: number;
  cost: number;
  reconciled_total_plays: number;
  delivery_pct: number;
  started_at: string;
  closed_at: string | null;
  total_paid: number;
  days_open: number;
};

export function useFinancialOverview() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const summaryQuery = useQuery({
    queryKey: ["financial-summary"],
    enabled: !!user,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_financial_summary").select("*").limit(1000);
      if (error) throw error;
      return (data ?? []) as FinancialSummaryRow[];
    },
  });

  const unallocatedQuery = useQuery({
    queryKey: ["financial-unallocated"],
    enabled: !!user,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_financial_unallocated_cost")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return (data ?? { total_nao_alocado: 0, num_compras: 0 }) as {
        total_nao_alocado: number;
        num_compras: number;
      };
    },
  });

  const purchasesQuery = useQuery({
    queryKey: ["financial-purchases"],
    enabled: !!user,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curator_purchases")
        .select("id, deal_id, curator_id, amount, plays_purchased, purchased_at, note")
        .order("purchased_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        deal_id: string | null;
        curator_id: string;
        amount: number;
        plays_purchased: number;
        purchased_at: string;
        note: string | null;
      }>;
    },
  });

  const dealsQuery = useQuery({
    queryKey: ["financial-deals"],
    enabled: !!user,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curator_deals")
        .select(
          "id, campaign_id, curator_id, curator_name, song_name, target_plays, cost, reconciled_total_plays, started_at, closed_at",
        )
        .order("started_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Realtime: compras de curadoria atualizam summary + purchases + unallocated
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`financial-live-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_purchases" },
        () => {
          qc.invalidateQueries({ queryKey: ["financial-purchases"] });
          qc.invalidateQueries({ queryKey: ["financial-unallocated"] });
          qc.invalidateQueries({ queryKey: ["financial-summary"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deals" },
        () => {
          qc.invalidateQueries({ queryKey: ["financial-deals"] });
          qc.invalidateQueries({ queryKey: ["financial-summary"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, qc]);

  const summary = summaryQuery.data ?? [];
  const purchases = purchasesQuery.data ?? [];
  const unallocated = unallocatedQuery.data ?? { total_nao_alocado: 0, num_compras: 0 };
  const dealsRaw = dealsQuery.data ?? [];

  const dealsFinance = useMemo<DealFinanceRow[]>(() => {
    const paid = new Map<string, number>();
    for (const p of purchases) {
      if (!p.deal_id) continue;
      paid.set(p.deal_id, (paid.get(p.deal_id) ?? 0) + Number(p.amount));
    }
    return dealsRaw.map((d) => {
      const target = Number(d.target_plays ?? 0);
      const delivered = Number(d.reconciled_total_plays ?? 0);
      const start = d.started_at ? new Date(d.started_at) : new Date();
      const days = Math.max(0, Math.floor((Date.now() - start.getTime()) / 86_400_000));
      return {
        deal_id: d.id,
        campaign_id: d.campaign_id,
        curator_id: d.curator_id ?? null,
        curator_name: d.curator_name,
        song_name: d.song_name,
        target_plays: target,
        cost: Number(d.cost ?? 0),
        reconciled_total_plays: delivered,
        delivery_pct: target > 0 ? Math.min(100, (delivered / target) * 100) : 0,
        started_at: d.started_at,
        closed_at: d.closed_at,
        total_paid: paid.get(d.id) ?? 0,
        days_open: days,
      };
    });
  }, [dealsRaw, purchases]);

  const totals = useMemo(() => {
    let recebido = 0;
    let cobrado = 0;
    let pago = 0;
    for (const s of summary) {
      recebido += Number(s.valor_recebido ?? 0);
      cobrado += Number(s.valor_cobrado ?? 0);
      pago += Number(s.total_pago_curadores ?? 0);
    }
    const margem = recebido - pago;
    const custoTotalCaixa = purchases.reduce((acc, p) => acc + Number(p.amount ?? 0), 0);
    return {
      cobrado,
      recebido,
      pago,
      margem,
      margemPct: recebido > 0 ? (margem / recebido) * 100 : null,
      custoTotalCaixa,
      custoNaoAlocado: Number(unallocated.total_nao_alocado ?? 0),
      numComprasNaoAlocadas: Number(unallocated.num_compras ?? 0),
    };
  }, [summary, purchases, unallocated]);

  const reload = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["financial-summary"] }),
      qc.invalidateQueries({ queryKey: ["financial-purchases"] }),
      qc.invalidateQueries({ queryKey: ["financial-unallocated"] }),
      qc.invalidateQueries({ queryKey: ["financial-deals"] }),
    ]);
  }, [qc]);

  // registerPayment agora cria uma curator_purchase vinculada ao deal (Opção A).
  const registerPayment = useCallback(
    async (input: {
      deal_id: string;
      curator_id: string;
      amount: number;
      plays_purchased: number;
      payment_date?: string; // mantido por compat — vira purchased_at
      method?: string;
      notes?: string;
    }) => {
      if (!user?.id) throw new Error("Sessão expirada");
      const purchasedAt = input.payment_date
        ? new Date(`${input.payment_date}T12:00:00`).toISOString()
        : new Date().toISOString();
      const noteParts = [input.method, input.notes].filter(Boolean);
      const { error } = await supabase.from("curator_purchases").insert({
        user_id: user.id,
        curator_id: input.curator_id,
        deal_id: input.deal_id,
        amount: Number(input.amount.toFixed(2)),
        plays_purchased: Math.max(0, Math.round(input.plays_purchased)),
        purchased_at: purchasedAt,
        note: noteParts.length > 0 ? noteParts.join(" · ") : null,
      });
      if (error) throw error;
      await reload();
    },
    [user, qc, reload],
  );

  const loading =
    (summaryQuery.isLoading || purchasesQuery.isLoading || dealsQuery.isLoading) &&
    summary.length === 0 &&
    purchases.length === 0 &&
    dealsRaw.length === 0;

  return {
    summary,
    purchases,
    dealsFinance,
    totals,
    loading,
    reload,
    registerPayment,
  };
}
