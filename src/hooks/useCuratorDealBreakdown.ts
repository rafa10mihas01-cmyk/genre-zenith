// useCuratorDealBreakdown — busca a separação Curador / Ecossistema / Total
// via RPC `get_curator_deal_breakdown`. Não interfere em progress/reconcile.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CuratorDealBreakdown = {
  curator: { playlists: number; plays: number };
  ecosystem: {
    editorial: { playlists: number; plays: number };
    algorithmic: { playlists: number; plays: number };
    organic: { playlists: number; plays: number };
    suspicious: { playlists: number; plays: number };
  };
  total: { playlists: number; plays: number };
  baseline_plays: number;
  target_plays: number;
};

export function useCuratorDealBreakdown(dealId: string | null | undefined) {
  return useQuery({
    queryKey: ["curator-deal-breakdown", dealId],
    enabled: !!dealId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<CuratorDealBreakdown | null> => {
      if (!dealId) return null;
      const { data, error } = await supabase.rpc(
        "get_curator_deal_breakdown" as never,
        { p_deal_id: dealId } as never,
      );
      if (error) throw error;
      const obj = (data ?? null) as unknown as CuratorDealBreakdown | { error: string } | null;
      if (!obj || (obj as { error?: string }).error) return null;
      return obj as CuratorDealBreakdown;
    },
  });
}

export function ecosystemTotal(b: CuratorDealBreakdown | null | undefined) {
  if (!b) return { playlists: 0, plays: 0 };
  const e = b.ecosystem;
  return {
    playlists:
      e.editorial.playlists + e.algorithmic.playlists + e.organic.playlists + e.suspicious.playlists,
    plays: e.editorial.plays + e.algorithmic.plays + e.organic.plays + e.suspicious.plays,
  };
}
