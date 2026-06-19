// useFinancialOverview — HOOK do módulo Financeiro.
// Fase 14.1: KPIs canônicos (cobrado, recebido, custo operacional, margem) vêm do
// v_campaign_overview via useCockpitOverview. As demais leituras (CPP por curador,
// compras, deals detalhados) seguem como dados auxiliares — não são KPIs disputados.
import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCockpitOverview } from "@/hooks/useCampaignOverview";

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

export type CuratorFinanceRow = {
  curator_id: string;
  user_id: string;
  name: string;
  plays_purchased: number;
  total_cost: number;
  cpp: number | null;
  last_purchase_at: string | null;
  purchase_count: number;
};

export type GlobalFinanceTotals = {
  total_plays_purchased: number;
  total_spent: number;
  global_cpp: number | null;
  purchase_count: number;
};

export type CuratorPurchase = {
  id: string;
  user_id: string;
  curator_id: string;
  deal_id: string | null;
  plays_purchased: number;
  amount: number;
  cpp: number | null;
  note: string | null;
  purchased_at: string;
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

  // Fase 14.1: receita/custo/margem por campanha vêm do overview consolidado.
  const overviewQuery = useCockpitOverview();
  const overviewCampaigns = useMemo(() => overviewQuery.data?.campaigns ?? [], [overviewQuery.data]);
  const overviewTotals = overviewQuery.data?.totals;

  // Adapter: mantém a shape FinancialSummaryRow para os consumidores existentes.
  const summary = useMemo<FinancialSummaryRow[]>(
    () =>
      overviewCampaigns.map((c) => ({
        campaign_id: c.campaign_id,
        track_name: c.track_name,
        artist: c.artist,
        campaign_status: c.status,
        valor_cobrado: c.contratado,
        valor_recebido: c.recebido,
        receita_pendente: c.pendente,
        total_pago_curadores: c.custo_operacional,
        margem_bruta: c.margem_prevista,
        margem_pct: c.margem_pct,
        num_deals: c.deals_total,
        created_at: c.created_at,
      })),
    [overviewCampaigns],
  );
  const summaryQuery = overviewQuery; // mantém compat com flags de loading

  const byCuratorQuery = useQuery({
    queryKey: ["financial-by-curator"],
    enabled: !!user,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_curator_finance").select("*");
      if (error) throw error;
      return (data ?? []) as CuratorFinanceRow[];
    },
  });

  const globalTotalsQuery = useQuery({
    queryKey: ["financial-global-totals"],
    enabled: !!user,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_curator_global_finance")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return (data ?? {
        total_plays_purchased: 0,
        total_spent: 0,
        global_cpp: null,
        purchase_count: 0,
      }) as GlobalFinanceTotals;
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
        .select("*")
        .order("purchased_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as CuratorPurchase[];
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

  // Realtime único do módulo Financeiro
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
          qc.invalidateQueries({ queryKey: ["financial-by-curator"] });
          qc.invalidateQueries({ queryKey: ["financial-global-totals"] });
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

  // 'summary' já é derivado do overview consolidado (definido acima).
  const byCurator = useMemo(() => byCuratorQuery.data ?? [], [byCuratorQuery.data]);
  const globalTotals = useMemo(() => globalTotalsQuery.data ?? {
    total_plays_purchased: 0,
    total_spent: 0,
    global_cpp: null,
    purchase_count: 0,
  }, [globalTotalsQuery.data]);
  const purchases = useMemo(() => purchasesQuery.data ?? [], [purchasesQuery.data]);
  const unallocated = useMemo(() => unallocatedQuery.data ?? { total_nao_alocado: 0, num_compras: 0 }, [unallocatedQuery.data]);
  const dealsRaw = useMemo(() => dealsQuery.data ?? [], [dealsQuery.data]);

  // dealsFinance: junta cost/target/delivered do deal com total_paid agregado das compras
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

  // totals — fonte canônica = v_campaign_overview (via useCockpitOverview).
  // Cliente / Campanha / Financeiro / Cockpit consomem exatamente estes números.
  const totals = useMemo(() => {
    const cobrado = overviewTotals?.contratado ?? 0;
    const recebido = overviewTotals?.recebido ?? 0;
    const pagoPorCampanha = overviewTotals?.custo_operacional ?? 0;
    const margem = overviewTotals?.margem_prevista ?? 0;
    const margemPct = overviewTotals?.margem_pct ?? null;
    return {
      cobrado,
      recebido,
      pagoPorCampanha,
      custoCaixa: Number(globalTotals.total_spent ?? 0),
      cppGlobal: globalTotals.global_cpp,
      totalPlays: Number(globalTotals.total_plays_purchased ?? 0),
      purchaseCount: Number(globalTotals.purchase_count ?? 0),
      curatorsCount: byCurator.length,
      margem,
      margemPct,
      custoNaoAlocado: Number(unallocated.total_nao_alocado ?? 0),
      numComprasNaoAlocadas: Number(unallocated.num_compras ?? 0),
    };
  }, [overviewTotals, byCurator, globalTotals, unallocated]);

  const reload = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["financial-summary"] }),
      qc.invalidateQueries({ queryKey: ["financial-by-curator"] }),
      qc.invalidateQueries({ queryKey: ["financial-global-totals"] }),
      qc.invalidateQueries({ queryKey: ["financial-purchases"] }),
      qc.invalidateQueries({ queryKey: ["financial-unallocated"] }),
      qc.invalidateQueries({ queryKey: ["financial-deals"] }),
    ]);
  }, [qc]);

  // CRUD oficial de lançamentos financeiros
  const addPurchase = useCallback(
    async (input: {
      curator_id: string;
      plays_purchased: number;
      amount: number;
      note?: string | null;
      deal_id?: string | null;
      purchased_at?: string;
    }) => {
      if (!user?.id) throw new Error("Sessão expirada");
      const { data, error } = await supabase
        .from("curator_purchases")
        .insert({
          user_id: user.id,
          curator_id: input.curator_id,
          deal_id: input.deal_id ?? null,
          plays_purchased: Math.max(0, Math.round(input.plays_purchased)),
          amount: Math.max(0, Number(input.amount.toFixed(2))),
          note: input.note ?? null,
          purchased_at: input.purchased_at ?? new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      await reload();
      return data as CuratorPurchase;
    },
    [user, reload],
  );

  const updatePurchase = useCallback(
    async (
      id: string,
      patch: {
        plays_purchased: number;
        amount: number;
        note?: string | null;
        purchased_at?: string;
      },
    ) => {
      if (!user?.id) throw new Error("Sessão expirada");
      const { data, error } = await supabase
        .from("curator_purchases")
        .update({
          plays_purchased: Math.max(0, Math.round(patch.plays_purchased)),
          amount: Math.max(0, Number(patch.amount.toFixed(2))),
          note: patch.note ?? null,
          purchased_at: patch.purchased_at,
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      await reload();
      return data as CuratorPurchase;
    },
    [user, reload],
  );

  const deletePurchase = useCallback(
    async (id: string) => {
      if (!user?.id) throw new Error("Sessão expirada");
      const { error } = await supabase.from("curator_purchases").delete().eq("id", id);
      if (error) throw error;
      await reload();
    },
    [user, reload],
  );

  // Compat com FinancialOverview/DealPaymentDialog (atalho para addPurchase)
  const registerPayment = useCallback(
    async (input: {
      deal_id: string;
      curator_id: string;
      amount: number;
      plays_purchased: number;
      payment_date?: string;
      method?: string;
      notes?: string;
    }) => {
      const purchasedAt = input.payment_date
        ? new Date(`${input.payment_date}T12:00:00`).toISOString()
        : new Date().toISOString();
      const noteParts = [input.method, input.notes].filter(Boolean);
      await addPurchase({
        curator_id: input.curator_id,
        deal_id: input.deal_id,
        amount: input.amount,
        plays_purchased: input.plays_purchased,
        purchased_at: purchasedAt,
        note: noteParts.length > 0 ? noteParts.join(" · ") : null,
      });
    },
    [addPurchase],
  );

  const loading =
    (summaryQuery.isLoading ||
      purchasesQuery.isLoading ||
      dealsQuery.isLoading ||
      byCuratorQuery.isLoading ||
      globalTotalsQuery.isLoading) &&
    summary.length === 0 &&
    purchases.length === 0 &&
    dealsRaw.length === 0 &&
    byCurator.length === 0;

  return {
    // dados
    summary,
    byCurator,
    globalTotals,
    purchases,
    dealsFinance,
    totals,
    // estado
    loading,
    // ações
    reload,
    addPurchase,
    updatePurchase,
    deletePurchase,
    registerPayment,
  };
}
