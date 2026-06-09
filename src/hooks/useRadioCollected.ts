import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RadioCollected = {
  campaign_id: string;
  start_plays_7d: number | null;
  start_captured_at: string | null;
  current_plays_7d: number;
  last_captured_at: string;
  radio_delta: number;
};

/**
 * Lê a função segura `get_campaign_radio_collected` (baseline ancorada na ativação da campanha).
 * Compartilhado entre RadioCollectedCard e OverviewTab.
 */
export function useRadioCollected(campaignId: string | undefined) {
  const query = useQuery({
    queryKey: ["radio_collected", campaignId],
    enabled: !!campaignId,
    queryFn: async () => {
      const { data: rows } = await (supabase as any)
        .rpc("get_campaign_radio_collected", { _campaign_id: campaignId });
      const row = Array.isArray(rows) ? rows[0] : null;
      return (row as RadioCollected | null) ?? null;
    },
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading && !query.data,
  };
}
