// useCuratorDealsList — versão LEVE do useCuratorDeals.
// Carrega APENAS deals + curators + balances (3 queries) — sem logs, songs,
// playlists ou alerts. Use em telas que listam/filtram deals mas não precisam
// do histórico carregado (ex.: /financeiro).
//
// Para detalhe de um deal específico, use useCuratorDealDetail(dealId).
// Para a tela master (/playlist-deals) com tudo carregado, continua valendo
// o useCuratorDeals tradicional.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { CuratorDeal } from "@/lib/curatorDealsUtils";
import type { Curator, CuratorBalance } from "@/hooks/useCuratorDeals";

export function useCuratorDealsList() {
  const { user } = useAuth();
  const [deals, setDeals] = useState<CuratorDeal[]>([]);
  const [curators, setCurators] = useState<Curator[]>([]);
  const [balances, setBalances] = useState<CuratorBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!user) {
      hasLoadedRef.current = false;
      setDeals([]);
      setCurators([]);
      setBalances([]);
      setLoading(false);
      return;
    }
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    try {
      const [dealsRes, curatorsRes, balancesRes] = await Promise.all([
        supabase
          .from("curator_deals")
          .select("*")
          .or("source.is.null,source.neq.campaign_internal")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("curators")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase.from("v_curator_balance").select("*").limit(2000),
      ]);
      if (dealsRes.error) throw dealsRes.error;
      if (curatorsRes.error) throw curatorsRes.error;
      if (balancesRes.error) throw balancesRes.error;
      setDeals((dealsRes.data ?? []) as CuratorDeal[]);
      setCurators((curatorsRes.data ?? []) as Curator[]);
      setBalances((balancesRes.data ?? []) as CuratorBalance[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime mínimo: só re-puxa a lista quando deals mudam.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`curator-deals-list-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deals" },
        () => {
          load();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, load]);

  return { deals, curators, balances, loading, error, reload: load };
}
