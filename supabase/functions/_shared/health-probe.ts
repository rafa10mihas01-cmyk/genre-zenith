// FASE 4.C.1 — Health probes uniformes (health_probes table).
// Uso em qualquer probe (OCR/Browser/SMTP/Gateway/Match/Writer/Delivery/Parser).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ProbeStatus = "ok" | "degraded" | "down";
export type ProbeSubsystem =
  | "ocr" | "browser" | "smtp" | "gateway"
  | "match" | "writer" | "delivery" | "parser"
  | "spotify" | "db" | "cron";

export interface ProbeArgs {
  probeName: string;
  subsystem: ProbeSubsystem;
  status: ProbeStatus;
  latencyMs?: number;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorMsg?: string | null;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

export async function recordProbe(sb: SupabaseClient, p: ProbeArgs): Promise<void> {
  try {
    await sb.from("health_probes").insert({
      probe_name: p.probeName,
      subsystem: p.subsystem,
      status: p.status,
      latency_ms: p.latencyMs ?? null,
      last_success_at: p.lastSuccessAt ?? (p.status === "ok" ? new Date().toISOString() : null),
      last_error_at: p.lastErrorAt ?? (p.status !== "ok" ? new Date().toISOString() : null),
      last_error_msg: p.lastErrorMsg ?? null,
      metadata: p.metadata ?? {},
      correlation_id: p.correlationId ?? null,
    });
  } catch (e) {
    console.error("[recordProbe]", e);
  }
}

/** Wrap padrão: roda uma probe, mede latência e grava. */
export async function runProbe<T>(
  sb: SupabaseClient,
  base: Omit<ProbeArgs, "status" | "latencyMs">,
  fn: () => Promise<T>,
): Promise<{ ok: boolean; result?: T; error?: string }> {
  const t0 = Date.now();
  try {
    const result = await fn();
    await recordProbe(sb, { ...base, status: "ok", latencyMs: Date.now() - t0 });
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordProbe(sb, { ...base, status: "down", latencyMs: Date.now() - t0, lastErrorMsg: msg });
    return { ok: false, error: msg };
  }
}
