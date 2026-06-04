import { useEffect, useMemo, useState } from "react";
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
 *
 * IMPORTANTE: chame este hook UMA VEZ no componente pai, passando todos os
 * deal IDs visíveis. Não chame por linha — cria N queries e cascata de
 * setStates durante o scroll inicial.
 */
export function useDeliveryStatusMap(dealIds: string[]) {
  const [map, setMap] = useState<Record<string, DeliveryStatusRow>>({});
  // Estabiliza a chave: ordena e deduplica pra evitar refetch quando a ordem muda.
  const key = useMemo(() => {
    if (dealIds.length === 0) return "";
    return Array.from(new Set(dealIds)).sort().join(",");
  }, [dealIds]);

  useEffect(() => {
    if (!key) {
      setMap({});
      return;
    }
    let cancelled = false;
    const ids = key.split(",");
    (async () => {
      const { data } = await supabase
        .from("curator_deal_delivery_status")
        .select("*")
        .in("deal_id", ids);
      if (cancelled || !data) return;
      const next: Record<string, DeliveryStatusRow> = {};
      for (const r of data as any[]) next[r.deal_id] = r as DeliveryStatusRow;
      setMap(next);
    })();
    return () => { cancelled = true; };
  }, [key]);

  return map;
}
