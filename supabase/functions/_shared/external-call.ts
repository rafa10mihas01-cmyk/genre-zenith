// FASE 4.D — External Call Helper (timeout + retry + breaker + log).
// Aditivo: NUNCA substitui clientes existentes (spotify-client mantém seu próprio
// breaker). Usado por NOVAS integrações ou por wrappers leves em torno de
// chamadas que hoje não têm proteção.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type IntegrationId =
  | "spotify"
  | "spotify_for_artists"
  | "browserless"
  | "ocr"
  | "smtp"
  | "supabase_rest"
  | "supabase_storage"
  | "openai"
  | "kworb"
  | "webhook"
  | "generic";

export type ExternalCallOptions = {
  integration: IntegrationId;
  operation: string;
  timeoutMs?: number;     // default 15000
  retries?: number;       // default 3
  retryOn?: number[];     // default [408,425,429,500,502,503,504]
  baseDelayMs?: number;   // default 300
  maxDelayMs?: number;    // default 8000
  correlationId?: string;
  /** Se true, ignora circuit breaker (usar só em probes). */
  bypassBreaker?: boolean;
};

type BreakerState = {
  state: "closed" | "open" | "half_open";
  failures: number;
  openedAt: number;
  lastError?: string;
};

// Breaker per-integration em memória. Persistência opcional via health_probes.
const BREAKER_THRESHOLD = 5;
const BREAKER_OPEN_MS = 60_000;
const breakers = new Map<IntegrationId, BreakerState>();

function getBreaker(id: IntegrationId): BreakerState {
  const b = breakers.get(id);
  if (b) return b;
  const init: BreakerState = { state: "closed", failures: 0, openedAt: 0 };
  breakers.set(id, init);
  return init;
}

function recordFailure(id: IntegrationId, err: string) {
  const b = getBreaker(id);
  b.failures += 1;
  b.lastError = err;
  if (b.failures >= BREAKER_THRESHOLD) {
    b.state = "open";
    b.openedAt = Date.now();
  }
}

function recordSuccess(id: IntegrationId) {
  const b = getBreaker(id);
  b.state = "closed";
  b.failures = 0;
  b.openedAt = 0;
  b.lastError = undefined;
}

function canCall(id: IntegrationId): { allowed: true } | { allowed: false; reason: string } {
  const b = getBreaker(id);
  if (b.state === "closed") return { allowed: true };
  if (b.state === "open") {
    if (Date.now() - b.openedAt >= BREAKER_OPEN_MS) {
      b.state = "half_open";
      return { allowed: true };
    }
    return { allowed: false, reason: `circuit_open:${id}` };
  }
  return { allowed: true }; // half_open: single probe
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => Math.floor(ms * (0.7 + Math.random() * 0.6));

let _sb: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }
  return _sb;
}

async function logCall(args: {
  integration: IntegrationId;
  operation: string;
  status: "ok" | "http_error" | "exception" | "circuit_open" | "timeout";
  http_status?: number;
  duration_ms: number;
  attempts: number;
  retry_after_sec?: number;
  error?: string;
  correlation_id?: string;
}) {
  try {
    await db().from("health_probes").insert({
      subsystem: args.integration,
      probe: args.operation,
      status: args.status === "ok" ? "ok" : "fail",
      latency_ms: args.duration_ms,
      http_status: args.http_status ?? null,
      attempts: args.attempts,
      error: args.error ?? null,
      correlation_id: args.correlation_id ?? null,
      metadata: { retry_after_sec: args.retry_after_sec ?? null },
    } as any);
  } catch { /* swallow */ }
}

/**
 * Fetch resiliente — timeout + retry exponencial com jitter + circuit breaker
 * + log automático em health_probes.
 *
 * Não substitui spotify-client (que tem seu próprio breaker oficial).
 * Use para integrações novas (Browserless, OpenAI, Kworb, Webhooks etc.).
 */
export async function externalFetch(
  url: string,
  init: RequestInit,
  opts: ExternalCallOptions,
): Promise<Response> {
  const {
    integration, operation, correlationId,
    timeoutMs = 15_000,
    retries = 3,
    retryOn = [408, 425, 429, 500, 502, 503, 504],
    baseDelayMs = 300,
    maxDelayMs = 8_000,
    bypassBreaker = false,
  } = opts;

  if (!bypassBreaker) {
    const gate = canCall(integration);
    if (!gate.allowed) {
      await logCall({
        integration, operation,
        status: "circuit_open",
        duration_ms: 0, attempts: 0,
        error: gate.reason, correlation_id: correlationId,
      });
      throw new Error(gate.reason);
    }
  }

  let attempt = 0;
  let lastErr: unknown = null;
  const start = performance.now();

  while (attempt <= retries) {
    attempt += 1;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ac.signal,
        headers: {
          ...(init.headers ?? {}),
          ...(correlationId ? { "x-correlation-id": correlationId } : {}),
        },
      });
      clearTimeout(t);

      if (retryOn.includes(res.status) && attempt <= retries) {
        const ra = parseInt(res.headers.get("retry-after") ?? "", 10);
        const delay = !isNaN(ra) ? Math.min(ra * 1000, maxDelayMs)
          : jitter(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs));
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        recordFailure(integration, `http_${res.status}`);
        await logCall({
          integration, operation,
          status: "http_error",
          http_status: res.status,
          duration_ms: Math.round(performance.now() - start),
          attempts: attempt,
          correlation_id: correlationId,
        });
        return res; // caller decides
      }

      recordSuccess(integration);
      await logCall({
        integration, operation,
        status: "ok",
        http_status: res.status,
        duration_ms: Math.round(performance.now() - start),
        attempts: attempt,
        correlation_id: correlationId,
      });
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      const msg = (e as Error)?.message ?? String(e);
      const isTimeout = msg === "timeout" || msg.includes("abort");
      if (attempt > retries) {
        recordFailure(integration, isTimeout ? "timeout" : msg);
        await logCall({
          integration, operation,
          status: isTimeout ? "timeout" : "exception",
          duration_ms: Math.round(performance.now() - start),
          attempts: attempt,
          error: msg, correlation_id: correlationId,
        });
        throw e;
      }
      await sleep(jitter(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)));
    }
  }

  throw lastErr ?? new Error("external_fetch_unknown");
}

/** Estado atual do breaker — útil pra dashboards. */
export function breakerSnapshot(): Record<string, BreakerState> {
  const out: Record<string, BreakerState> = {};
  for (const [k, v] of breakers) out[k] = { ...v };
  return out;
}
