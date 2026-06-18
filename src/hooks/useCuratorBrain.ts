import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type CuratorBrainSignal = {
  code: string;
  severity: "low" | "medium" | "high";
  message: string;
  detected_at: string;
};

export type CuratorBrainRecommendation = {
  priority: number;
  action: string;
  reason: string;
};

export type CuratorBrain = {
  id: string;
  curator_id: string;
  identity: {
    nome?: string;
    deal_type?: string;
    spotify_owner_id?: string | null;
    playlists_count?: number;
    total_followers_alcance?: number;
    age_days?: number;
  };
  reliability: {
    total_deals?: number;
    closed_deals?: number;
    successful?: number;
    failed?: number;
    avg_delivery_pct?: number | null;
    on_time_pct?: number | null;
    open_deals?: number;
  };
  economics: {
    total_invested?: number;
    total_paid_plays?: number;
    total_delivered_plays?: number;
    avg_cpp?: number | null;
    last_purchase_at?: string | null;
  };
  risk: {
    open_alerts?: number;
    high_alerts?: number;
    last_alert_at?: string | null;
  };
  capacity_avg_per_deal: number | null;
  capacity_p90: number | null;
  delivery_rate_pct: number | null;
  on_time_rate_pct: number | null;
  avg_cpp: number | null;
  roi_score: number | null;
  trust_score: number;
  signals: CuratorBrainSignal[];
  recommendations: CuratorBrainRecommendation[];
  confidence_score: number;
  last_calculated_at: string;
  metadata: Record<string, any>;
};

export function useCuratorBrain(curatorId?: string) {
  return useQuery({
    queryKey: ["curator_brain", curatorId],
    enabled: !!curatorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curator_brain")
        .select("*")
        .eq("curator_id", curatorId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as CuratorBrain | null;
    },
  });
}

/** Carrega cérebros em lote (lista de curadores). */
export function useCuratorBrainsByIds(curatorIds: string[]) {
  return useQuery({
    queryKey: ["curator_brain_batch", [...curatorIds].sort().join(",")],
    enabled: curatorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curator_brain")
        .select("curator_id, trust_score, confidence_score, delivery_rate_pct, on_time_rate_pct, signals, last_calculated_at")
        .in("curator_id", curatorIds);
      if (error) throw error;
      const map: Record<string, any> = {};
      (data ?? []).forEach((r: any) => { map[r.curator_id] = r; });
      return map;
    },
  });
}

export function useRecalcCuratorBrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (curatorId: string) => {
      const { data, error } = await supabase.functions.invoke("curator-brain-calc", {
        body: { curator_id: curatorId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao recalcular");
      return data;
    },
    onSuccess: (_, curatorId) => {
      qc.invalidateQueries({ queryKey: ["curator_brain", curatorId] });
      qc.invalidateQueries({ queryKey: ["curator_brain_batch"] });
      toast.success("Cérebro do curador atualizado");
    },
    onError: (e: Error) => toast.error(e?.message ?? "Erro ao recalcular"),
  });
}
