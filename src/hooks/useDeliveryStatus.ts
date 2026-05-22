import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DeliveryStatus = "on_track" | "lagging" | "spiking" | "paused";

export interface DeliveryStatusRow {
  deal_id: string;
  status: DeliveryStatus;
  expected_to_date: number;
  actual_to_date: number;
  delta_pct: number;
  reason: string | null;
  spike_playlist_ids: Array<{ id: string; name: string; streams_7d: number; cap_dia: number }>;
  last_checked_at: string;
}

/**
 * Lê o status de aderência (real vs planejado) dos curator_deals.
 * Atualizado 1x/dia pelo cron-deal-delivery-check.
 */
export function useDeliveryStatusMap(dealIds: string[]) {
  const [map, setMap] = useState<Record<string, DeliveryStatusRow>>({});

  useEffect(() => {
    if (dealIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("curator_deal_delivery_status")
        .select("*")
        .in("deal_id", dealIds);
      if (cancelled || !data) return;
      const next: Record<string, DeliveryStatusRow> = {};
      for (const r of data as any[]) next[r.deal_id] = r as DeliveryStatusRow;
      setMap(next);
    })();
    return () => { cancelled = true; };
  }, [dealIds.join(",")]);

  return map;
}
