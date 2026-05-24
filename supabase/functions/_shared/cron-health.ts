// Helper compartilhado pra reportar status de execução de cron jobs.
// Insere em `public.cron_health` mesma assinatura usada por snapshot-playlist-tracks.
//
// USO:
//   import { reportCronHealth } from "../_shared/cron-health.ts";
//   const startedAt = Date.now();
//   try { ... ; await reportCronHealth(sb, { job_name, status: "ok", metrics, startedAt, message }); }
//   catch (e) { await reportCronHealth(sb, { job_name, status: "error", startedAt, message: String(e) }); throw e; }
//
// Falhas no insert são engolidas — instrumentação NUNCA deve quebrar o cron.

// deno-lint-ignore no-explicit-any
type AnyClient = any;

export type CronHealthStatus = "ok" | "partial" | "error";

export interface CronHealthArgs {
  job_name: string;
  status: CronHealthStatus;
  startedAt: number;
  metrics?: Record<string, unknown>;
  message?: string;
}

export async function reportCronHealth(
  sb: AnyClient,
  { job_name, status, startedAt, metrics, message }: CronHealthArgs,
): Promise<void> {
  try {
    await sb.from("cron_health").insert({
      job_name,
      status,
      metrics: metrics ?? {},
      duration_ms: Date.now() - startedAt,
      message: message ? String(message).slice(0, 500) : null,
    });
  } catch {
    // Silencioso de propósito — instrumentação não pode derrubar o cron.
  }
}
