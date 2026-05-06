// _shared/ops-metrics.ts
// Telemetria operacional fire-and-forget. NUNCA bloqueia ou propaga erro.
// Uso:
//   const t0 = Date.now();
//   try { ... } finally {
//     recordMetric(supabase, { scope: "edge_function", operation: "register-curator-playlist", status, duration_ms: Date.now() - t0, deal_id, metadata });
//   }

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type OpsMetric = {
  scope: "edge_function" | "rpc" | "bot" | "collect" | "import" | "ocr" | string;
  operation: string;
  status?: "success" | "error" | "timeout" | "rate_limited" | "partial" | string;
  duration_ms?: number;
  deal_id?: string | null;
  song_id?: string | null;
  metadata?: Record<string, unknown>;
};

export function recordMetric(supabase: SupabaseClient, m: OpsMetric): void {
  // Fire-and-forget. Não usa await para não atrasar a resposta da edge function.
  try {
    void supabase
      .from("ops_metrics")
      .insert({
        scope: m.scope,
        operation: m.operation,
        status: m.status ?? "success",
        duration_ms: m.duration_ms ?? null,
        deal_id: m.deal_id ?? null,
        song_id: m.song_id ?? null,
        metadata: m.metadata ?? {},
      })
      .then(({ error }) => {
        if (error) console.warn("ops_metrics insert failed:", error.message);
      });
  } catch (e) {
    console.warn("recordMetric threw:", e);
  }
}

/** Helper para envolver uma operação async e registrar métrica automaticamente. */
export async function withMetric<T>(
  supabase: SupabaseClient,
  base: Omit<OpsMetric, "status" | "duration_ms">,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await fn();
    recordMetric(supabase, { ...base, status: "success", duration_ms: Date.now() - t0 });
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = /timeout/i.test(msg);
    recordMetric(supabase, {
      ...base,
      status: isTimeout ? "timeout" : "error",
      duration_ms: Date.now() - t0,
      metadata: { ...(base.metadata ?? {}), error: msg.slice(0, 240) },
    });
    throw e;
  }
}
