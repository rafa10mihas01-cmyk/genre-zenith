import { useEffect, useState } from "react";
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
 * Compartilhado entre RadioCollectedCard e OverviewTab (linha Rádio dentro do Ecossistema).
 */
export function useRadioCollected(campaignId: string | undefined) {
  const [data, setData] = useState<RadioCollected | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!campaignId) { setData(null); setLoading(false); return; }
    let active = true;
    setLoading(true);
    void (async () => {
      const { data: rows } = await (supabase as any)
        .rpc("get_campaign_radio_collected", { _campaign_id: campaignId });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!active) return;
      setData((row as RadioCollected | null) ?? null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [campaignId]);

  return { data, loading };
}
