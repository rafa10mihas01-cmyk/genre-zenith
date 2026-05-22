// useFinancialOverview — agrega dados da view v_financial_summary,
// pagamentos a curadores (curator_deal_payments) e deals ativos.
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [summary, setSummary] = useState<FinancialSummaryRow[]>([]);
  const [payments, setPayments] = useState<DealPayment[]>([]);
  const [dealsFinance, setDealsFinance] = useState<DealFinanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [sumRes, payRes, dealsRes] = await Promise.all([
      supabase.from("v_financial_summary").select("*"),
      supabase
        .from("curator_deal_payments")
        .select("*")
        .order("payment_date", { ascending: false })
        .limit(500),
      supabase
        .from("curator_deals")
        .select(
          "id, campaign_id, curator_name, song_name, target_plays, cost, reconciled_total_plays, started_at, closed_at",
        )
        .order("started_at", { ascending: false })
        .limit(500),
    ]);

    if (!sumRes.error && sumRes.data) setSummary(sumRes.data as FinancialSummaryRow[]);
    if (!payRes.error && payRes.data) setPayments(payRes.data as DealPayment[]);

    const paid = new Map<string, number>();
    for (const p of (payRes.data ?? []) as DealPayment[]) {
      paid.set(p.deal_id, (paid.get(p.deal_id) ?? 0) + Number(p.amount));
    }

    const rows: DealFinanceRow[] = ((dealsRes.data ?? []) as any[]).map((d) => {
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
    setDealsFinance(rows);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

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

  const registerPayment = useCallback(
    async (input: {
      deal_id: string;
      amount: number;
      payment_date?: string;
      method?: string;
      notes?: string;
    }) => {
      const { error } = await supabase.from("curator_deal_payments").insert({
        deal_id: input.deal_id,
        amount: Number(input.amount.toFixed(2)),
        payment_date: input.payment_date ?? new Date().toISOString().slice(0, 10),
        method: input.method ?? null,
        notes: input.notes ?? null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      await load();
    },
    [user, load],
  );

  return { summary, payments, dealsFinance, totals, loading, reload: load, registerPayment };
}
