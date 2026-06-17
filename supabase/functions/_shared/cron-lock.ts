// cron-lock.ts — Wrapper genérico de execução de cron com:
//   • Advisory lock Postgres (pg_try_advisory_lock) por nome de job → exclusão mútua
//     entre workers, mesmo em múltiplas instâncias da edge function.
//   • Idempotência via lock + janela mínima entre execuções (min_interval_ms).
//   • Registro completo em public.cron_run_log (start/end, duração, sucesso,
//     erro, retries, correlation_id, payload).
//   • Retries com backoff exponencial + jitter.
//   • Timeout via AbortSignal (chamador respeita ctx.signal).
//
// USO:
//   import { withCronJob } from "../_shared/cron-lock.ts";
//   Deno.serve(async (req) => withCronJob(sb, {
//     job_name: "cron-reconcile-curator-deals",
//     max_retries: 2,
//     timeout_ms: 60_000,
//   }, async (ctx) => {
//     // ... lógica do cron ...
//     return { deals_processed: N };
//   }));
//
// Falhas de instrumentação NUNCA propagam — o cron continua mesmo que o log falhe.

// deno-lint-ignore no-explicit-any
type AnyClient = any;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface CronJobOptions {
  job_name: string;
  /** Tentativas adicionais após a primeira falha. Default 0. */
  max_retries?: number;
  /** Timeout total da execução em ms. Default 120_000. */
  timeout_ms?: number;
  /** Janela mínima entre duas execuções bem-sucedidas (idempotência). 0 = desabilitado. */
  min_interval_ms?: number;
  /** Hostname / worker id (default Deno region). */
  worker?: string;
  /** Correlation id (default gerado). */
  correlation_id?: string;
  /** Payload arbitrário pra auditoria. */
  payload?: Record<string, unknown>;
}

export interface CronCtx {
  job_name: string;
  correlation_id: string;
  worker: string;
  attempt: number;
  signal: AbortSignal;
  startedAt: number;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Content-Type": "application/json",
};

function hashJobName(name: string): bigint {
  // FNV-1a 64-bit → bigint estável (mesmo job_name = mesma lock key).
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const ch of name) {
    hash ^= BigInt(ch.charCodeAt(0));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  // Postgres bigint é signed 64-bit. Map para signed range.
  if (hash >= 0x8000000000000000n) hash -= 0x10000000000000000n;
  return hash;
}

async function tryAdvisoryLock(sb: AnyClient, job_name: string): Promise<boolean> {
  try {
    const key = hashJobName(job_name).toString();
    const { data, error } = await sb.rpc("cron_try_advisory_lock", { p_key: key });
    if (error) return true; // Função ainda não existe → assume ok (fail-open p/ não derrubar cron).
    return Boolean(data);
  } catch {
    return true;
  }
}

async function releaseAdvisoryLock(sb: AnyClient, job_name: string): Promise<void> {
  try {
    const key = hashJobName(job_name).toString();
    await sb.rpc("cron_advisory_unlock", { p_key: key });
  } catch { /* ignore */ }
}

async function hasRecentSuccess(sb: AnyClient, job_name: string, ms: number): Promise<boolean> {
  if (ms <= 0) return false;
  try {
    const since = new Date(Date.now() - ms).toISOString();
    const { count } = await sb
      .from("cron_run_log")
      .select("id", { count: "exact", head: true })
      .eq("cron_name", job_name)
      .eq("success", true)
      .gte("started_at", since);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

async function logStart(sb: AnyClient, args: {
  job_name: string;
  correlation_id: string;
  payload?: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const { data } = await sb.from("cron_run_log").insert({
      cron_name: args.job_name,
      started_at: new Date().toISOString(),
      success: false,
      correlation_id: args.correlation_id,
      payload: args.payload ?? {},
      retries: 0,
    }).select("id").maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

async function logFinish(sb: AnyClient, id: string | null, args: {
  success: boolean;
  duration_ms: number;
  error_message?: string;
  retries: number;
  payload?: Record<string, unknown>;
}): Promise<void> {
  if (!id) return;
  try {
    await sb.from("cron_run_log").update({
      finished_at: new Date().toISOString(),
      duration_ms: args.duration_ms,
      success: args.success,
      error_message: args.error_message ? String(args.error_message).slice(0, 1000) : null,
      retries: args.retries,
      payload: args.payload ?? {},
    }).eq("id", id);
  } catch { /* ignore */ }
}

function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 500 * Math.pow(2, attempt));
  const jitter = Math.random() * 0.3 * base;
  return Math.floor(base + jitter);
}

export async function withCronJob<T>(
  sb: AnyClient,
  opts: CronJobOptions,
  fn: (ctx: CronCtx) => Promise<T>,
): Promise<Response> {
  const job_name = opts.job_name;
  const correlation_id = opts.correlation_id ?? crypto.randomUUID();
  const worker = opts.worker ?? (Deno.env.get("DENO_REGION") ?? "edge");
  const timeout_ms = opts.timeout_ms ?? 120_000;
  const max_retries = Math.max(0, opts.max_retries ?? 0);

  // Idempotência: se janela mínima e já houve execução bem-sucedida, pula.
  if (await hasRecentSuccess(sb, job_name, opts.min_interval_ms ?? 0)) {
    return new Response(
      JSON.stringify({ ok: true, skipped: "recent_success", job_name }),
      { status: 200, headers: corsHeaders },
    );
  }

  // Lock distribuído.
  const got = await tryAdvisoryLock(sb, job_name);
  if (!got) {
    return new Response(
      JSON.stringify({ ok: false, skipped: "locked", job_name }),
      { status: 423, headers: corsHeaders },
    );
  }

  const logId = await logStart(sb, { job_name, correlation_id, payload: opts.payload });
  const startedAt = Date.now();

  let attempt = 0;
  let lastErr: unknown = null;
  let result: T | undefined;

  while (attempt <= max_retries) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(new Error("cron_timeout")), timeout_ms);
    try {
      result = await fn({
        job_name,
        correlation_id,
        worker,
        attempt,
        signal: ac.signal,
        startedAt,
      });
      clearTimeout(to);
      await logFinish(sb, logId, {
        success: true,
        duration_ms: Date.now() - startedAt,
        retries: attempt,
        payload: { ...(opts.payload ?? {}), worker, result_kind: typeof result },
      });
      await releaseAdvisoryLock(sb, job_name);
      return new Response(
        JSON.stringify({ ok: true, job_name, correlation_id, attempts: attempt + 1, result }),
        { status: 200, headers: corsHeaders },
      );
    } catch (e) {
      clearTimeout(to);
      lastErr = e;
      attempt++;
      if (attempt > max_retries) break;
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
    }
  }

  const msg = (lastErr as Error)?.message ?? String(lastErr);
  await logFinish(sb, logId, {
    success: false,
    duration_ms: Date.now() - startedAt,
    error_message: msg,
    retries: attempt - 1,
    payload: { ...(opts.payload ?? {}), worker },
  });
  await releaseAdvisoryLock(sb, job_name);

  return new Response(
    JSON.stringify({ ok: false, job_name, correlation_id, attempts: attempt, error: msg }),
    { status: 500, headers: corsHeaders },
  );
}
