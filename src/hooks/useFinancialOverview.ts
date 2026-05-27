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

  const paymentsQuery = useQuery({
    queryKey: ["deal-payments"],
    enabled: !!user,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curator_deal_payments")
        .select("*")
        .order("payment_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as DealPayment[];
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
          "id, campaign_id, curator_name, song_name, target_plays, cost, reconciled_total_plays, started_at, closed_at",
        )
        .order("started_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Realtime: pagamentos atualizam summary + payments
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`financial-live-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deal_payments" },
        () => {
          qc.invalidateQueries({ queryKey: ["deal-payments"] });
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
  const payments = paymentsQuery.data ?? [];
  const dealsRaw = dealsQuery.data ?? [];

  const dealsFinance = useMemo<DealFinanceRow[]>(() => {
    const paid = new Map<string, number>();
    for (const p of payments) {
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
  }, [dealsRaw, payments]);

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
    return {
      cobrado,
      recebido,
      pago,
      margem,
      margemPct: recebido > 0 ? (margem / recebido) * 100 : null,
    };
  }, [summary]);

  const reload = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["financial-summary"] }),
      qc.invalidateQueries({ queryKey: ["deal-payments"] }),
      qc.invalidateQueries({ queryKey: ["financial-deals"] }),
    ]);
  }, [qc]);

  const registerPayment = useCallback(
    async (input: {
      deal_id: string;
      amount: number;
      payment_date?: string;
      method?: string;
      notes?: string;
    }) => {
      const optimistic: DealPayment = {
        id: `tmp-${crypto.randomUUID()}`,
        deal_id: input.deal_id,
        amount: Number(input.amount.toFixed(2)),
        payment_date: input.payment_date ?? new Date().toISOString().slice(0, 10),
        method: input.method ?? null,
        notes: input.notes ?? null,
        created_at: new Date().toISOString(),
      };
      await qc.cancelQueries({ queryKey: ["deal-payments"] });
      const previous = qc.getQueryData<DealPayment[]>(["deal-payments"]);
      qc.setQueryData<DealPayment[]>(["deal-payments"], (old) => [optimistic, ...(old ?? [])]);

      const { error } = await supabase.from("curator_deal_payments").insert({
        deal_id: input.deal_id,
        amount: optimistic.amount,
        payment_date: optimistic.payment_date,
        method: optimistic.method,
        notes: optimistic.notes,
        created_by: user?.id ?? null,
      });
      if (error) {
        qc.setQueryData(["deal-payments"], previous);
        throw error;
      }
      await reload();
    },
    [user, qc, reload],
  );

  const loading =
    (summaryQuery.isLoading || paymentsQuery.isLoading || dealsQuery.isLoading) &&
    summary.length === 0 &&
    payments.length === 0 &&
    dealsRaw.length === 0;

  return { summary, payments, dealsFinance, totals, loading, reload, registerPayment };
}
