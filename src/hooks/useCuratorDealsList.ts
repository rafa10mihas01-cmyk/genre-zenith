// useCuratorDealsList — versão LEVE do useCuratorDeals.
// Refatorado para React Query: cache compartilhado entre /deals e /financeiro,
// volta instantâneo.
import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { CuratorDeal } from "@/lib/curatorDealsUtils";
import type { Curator, CuratorBalance } from "@/hooks/useCuratorDeals";

const KEY = ["curator_deals_list"] as const;

export function useCuratorDealsList() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: KEY,
    enabled: !!user,
    queryFn: async () => {
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
      return {
        deals: (dealsRes.data ?? []) as CuratorDeal[],
        curators: (curatorsRes.data ?? []) as Curator[],
        balances: (balancesRes.data ?? []) as CuratorBalance[],
      };
    },
  });

  const reload = useCallback(
    () => qc.invalidateQueries({ queryKey: KEY }),
    [qc],
  );

  // Realtime mínimo: só re-puxa a lista quando deals mudam.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`curator-deals-list-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "curator_deals" },
        () => { reload(); },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, reload]);

  return {
    deals: query.data?.deals ?? [],
    curators: query.data?.curators ?? [],
    balances: query.data?.balances ?? [],
    loading: query.isLoading && !query.data,
    error: query.error ? (query.error as Error).message : null,
    reload,
  };
}
