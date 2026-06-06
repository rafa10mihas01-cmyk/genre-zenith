import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type PlanExecutionSnapshot = Database["public"]["Tables"]["plan_execution_snapshots"]["Row"];

export function useLastPlanResult(playlistId: string | null) {
  return useQuery<PlanExecutionSnapshot | null>({
    queryKey: ["last-plan-result", playlistId],
    queryFn: async () => {
      if (!playlistId) return null;
      const { data, error } = await supabase
        .from("plan_execution_snapshots")
        .select("*")
        .eq("playlist_id", playlistId)
        .eq("status", "evaluated")
        .order("executed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!playlistId,
  });
}
