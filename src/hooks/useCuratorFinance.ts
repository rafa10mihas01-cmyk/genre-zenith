// useCuratorFinance — agregados financeiros derivados do ledger curator_purchases.
// Não substitui useCuratorDeals; complementa com CPP global, ranking e overbooking.
import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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

export type CuratorFinanceRow = {
  curator_id: string;
  name: string;
  plays_purchased: number;
  total_cost: number;
  cpp: number | null;
  last_purchase_at: string | null;
  purchase_count: number;
};

export function useCuratorFinance() {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState<CuratorPurchase[]>([]);
  const [byCurator, setByCurator] = useState<CuratorFinanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [pRes, fRes] = await Promise.all([
      supabase
        .from("curator_purchases")
        .select("*")
        .order("purchased_at", { ascending: false })
        .limit(200),
      supabase.from("v_curator_finance").select("*"),
    ]);
    if (!pRes.error && pRes.data) setPurchases(pRes.data as CuratorPurchase[]);
    if (!fRes.error && fRes.data) setByCurator(fRes.data as CuratorFinanceRow[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    let plays = 0;
    let spent = 0;
    for (const r of byCurator) {
      plays += Number(r.plays_purchased ?? 0);
      spent += Number(r.total_cost ?? 0);
    }
    return {
      totalPlays: plays,
      totalSpent: spent,
      globalCpp: plays > 0 ? spent / plays : null,
      curatorsCount: byCurator.length,
    };
  }, [byCurator]);

  const addPurchase = useCallback(
    async (input: {
      curator_id: string;
      plays_purchased: number;
      amount: number;
      note?: string;
      deal_id?: string | null;
      purchased_at?: string;
    }) => {
      if (!user) throw new Error("Usuário não autenticado");
      const { data, error } = await supabase
        .from("curator_purchases")
        .insert({
          user_id: user.id,
          curator_id: input.curator_id,
          plays_purchased: Math.max(0, Math.round(input.plays_purchased)),
          amount: Math.max(0, Number(input.amount.toFixed(2))),
          note: input.note ?? null,
          deal_id: input.deal_id ?? null,
          purchased_at: input.purchased_at ?? new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      await load();
      return data as CuratorPurchase;
    },
    [user, load],
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
      if (!user) throw new Error("Usuário não autenticado");
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
      await load();
      return data as CuratorPurchase;
    },
    [user, load],
  );

  const deletePurchase = useCallback(
    async (id: string) => {
      if (!user) throw new Error("Usuário não autenticado");
      const { error } = await supabase.from("curator_purchases").delete().eq("id", id);
      if (error) throw error;
      await load();
    },
    [user, load],
  );

  return { purchases, byCurator, totals, loading, reload: load, addPurchase, updatePurchase, deletePurchase };
}
