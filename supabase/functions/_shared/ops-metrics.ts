// _shared/ops-metrics.ts
// NO-OP após remoção da tabela ops_metrics. Mantido para compatibilidade dos
// imports existentes em edge functions do fluxo principal.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type OpsMetric = {
  scope: string;
  operation: string;
  status?: string;
  duration_ms?: number;
  deal_id?: string | null;
  song_id?: string | null;
  metadata?: Record<string, unknown>;
};

 
export function recordMetric(_supabase: SupabaseClient, _m: OpsMetric): void {
  /* no-op */
}

export async function withMetric<T>(
  _supabase: SupabaseClient,
  _base: Omit<OpsMetric, "status" | "duration_ms">,
  fn: () => Promise<T>,
): Promise<T> {
  return await fn();
}
