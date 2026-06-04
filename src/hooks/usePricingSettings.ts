// Hook centralizado de pricing.
// Custos: operacional (cost_per_stream_*) vs valor de mercado equivalente
// (market_per_stream_*). Preço de venda + margem alvo.
// Singleton por usuário (1 linha em pricing_settings).
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { COST_PER_STREAM, type CostPerStream } from "@/lib/campaignEngine";
import { useAuth } from "@/contexts/AuthContext";

export type PricingSettings = {
  cost_per_stream_eco: number;
  cost_per_stream_ext: number;
  market_per_stream_eco: number;
  market_per_stream_ext: number;
  price_per_stream_sell: number;
  target_margin_pct: number;
};

const DEFAULTS: PricingSettings = {
  cost_per_stream_eco: COST_PER_STREAM.eco,
  cost_per_stream_ext: COST_PER_STREAM.ext,
  market_per_stream_eco: 0.028,
  market_per_stream_ext: 0.035,
  price_per_stream_sell: 0.08,
  target_margin_pct: 50,
};

export function usePricingSettings() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["pricing_settings"],
    queryFn: async (): Promise<PricingSettings> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return DEFAULTS;

      const { data, error } = await supabase
        .from("pricing_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;

      if (!data) {
        const { data: created } = await supabase
          .from("pricing_settings")
          .insert({ user_id: user.id, ...DEFAULTS })
          .select("*")
          .maybeSingle();
        return (created as any) ?? DEFAULTS;
      }
      const d = data as any;
      return {
        cost_per_stream_eco: Number(d.cost_per_stream_eco),
        cost_per_stream_ext: Number(d.cost_per_stream_ext),
        market_per_stream_eco: Number(d.market_per_stream_eco ?? DEFAULTS.market_per_stream_eco),
        market_per_stream_ext: Number(d.market_per_stream_ext ?? DEFAULTS.market_per_stream_ext),
        price_per_stream_sell: Number(d.price_per_stream_sell),
        target_margin_pct: Number(d.target_margin_pct),
      };
    },
    staleTime: 5 * 60_000,
  });

  const settings = query.data ?? DEFAULTS;
  const costs: CostPerStream = {
    eco: settings.cost_per_stream_eco,
    ext: settings.cost_per_stream_ext,
  };

  const update = useMutation({
    mutationFn: async (patch: Partial<PricingSettings>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada");
      const { error } = await supabase
        .from("pricing_settings")
        .update(patch)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing_settings"] }),
  });

  return { settings, costs, isLoading: query.isLoading, update };
}
