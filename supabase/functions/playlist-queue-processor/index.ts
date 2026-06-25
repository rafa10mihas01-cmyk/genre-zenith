// playlist-queue-processor — Worker que consome playlist_operation_queue.
// Executado por cron a cada 2min. Pega até BATCH_SIZE jobs (um por playlist),
// executa o handler correspondente, marca done/failed.
//
// Pipeline por job:
//   1. claim_next_playlist_job() — atômico via SKIP LOCKED + NOT EXISTS (sem 2 jobs/playlist).
//   2. invoca a edge function-alvo via fetch service-role.
//   3. sucesso → status='done', completed_at=now.
//   4. falha:
//      - se 'playlist_locked' → reagenda em 30s, NÃO conta attempt.
//      - se attempts < max_attempts → reagenda com backoff exponencial 2/8/32min.
//      - senão → status='failed', loga no cockpit via cron_health.
//
// Antes de claim, roda reap_zombie_playlist_jobs() pra liberar jobs em 'processing' > 5min.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";
import { backoffSecondsForAttempt, enqueuePlaylistJob } from "../_shared/playlist-queue.ts";
import { getEditorialTier, shouldUseEditorialAI } from "../_shared/editorial-flag.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_ID = `proc-${crypto.randomUUID().slice(0, 8)}`;
const BATCH_SIZE = 5;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Job = {
  id: string;
  playlist_id: string;
  operation_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

type HandlerOutcome = { ok: boolean; error?: string; code?: string; retry_after?: number; blocked_until?: string | null };

/** Mapa operation_type → edge function que executa o trabalho. */
const HANDLERS: Record<string, { fn: string; body: (job: Job) => Record<string, unknown> }> = {
  AUTO_SYNC: {
    fn: "sync-managed-playlist-tracks",
    body: (j) => ({ playlist_id: j.playlist_id }),
  },
  BACKFILL: {
    fn: "sync-managed-playlist-tracks",
    body: (j) => ({ playlist_id: j.playlist_id, force: true }),
  },
  DIAGNOSE_ENGINE: {
    fn: "diagnose-managed-playlist",
    // skip_ai resolvido dinamicamente em invokeHandler() via feature flag.
    body: (j) => ({ playlist_id: j.playlist_id, source: "queue", ...j.payload }),
  },
  BRAIN_CALC: {
    // Fase 5.2 — BRAIN_CALC vindo da fila agora dispara o pipeline unificado.
    // O orquestrador roda dna→diagnose→brain→score com idempotência e lock.
    fn: "analysis-orchestrator",
    body: (j) => ({
      playlist_id: j.playlist_id,
      trigger_event: "manual_reanalyze",
      payload: { source: "queue:BRAIN_CALC", ...j.payload },
    }),
  },
};

async function invokeHandler(job: Job, sb: any): Promise<HandlerOutcome> {
  const handler = HANDLERS[job.operation_type];
  if (!handler) return { ok: false, error: `no_handler:${job.operation_type}` };

  // FASE 2 — Skip DIAGNOSE_ENGINE / BRAIN_CALC quando playlist está diagnose_blocked.
  // Mesma query também resolve `skip_ai` pela feature flag (system_flags.ai_editorial_tier).
  let resolvedBody = handler.body(job);
  if (job.operation_type === "DIAGNOSE_ENGINE" || job.operation_type === "BRAIN_CALC") {
    const { data: mp } = await sb
      .from("managed_playlists")
      .select("diagnose_blocked, followers")
      .eq("id", job.playlist_id)
      .maybeSingle();
    if (mp?.diagnose_blocked === true) {
      return { ok: true, error: "diagnose_blocked_skip" } as HandlerOutcome;
    }
    if (job.operation_type === "DIAGNOSE_ENGINE" && resolvedBody.skip_ai === undefined) {
      const tier = await getEditorialTier(sb);
      const useAi = shouldUseEditorialAI(mp?.followers ?? 0, tier);
      resolvedBody = { ...resolvedBody, skip_ai: !useAi };
    }
  }

  const url = `${SUPABASE_URL}/functions/v1/${handler.fn}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resolvedBody),
    });
  } catch (e) {
    return { ok: false, error: `network: ${(e as Error).message}` };
  }

  const txt = await resp.text();
  let parsed: any = null;
  try { parsed = JSON.parse(txt); } catch { /* */ }

  // 423 = playlist_locked → reagendar curto, sem queimar attempt
  if (resp.status === 423) return { ok: false, error: "playlist_locked" };

  const okBody = parsed?.ok !== false;
  if (resp.ok && okBody) return { ok: true };
  return {
    ok: false,
    error: parsed?.error ?? `http_${resp.status}: ${txt.slice(0, 200)}`,
    code: parsed?.code,
    retry_after: typeof parsed?.retry_after === "number" ? parsed.retry_after : undefined,
    blocked_until: typeof parsed?.blocked_until === "string" ? parsed.blocked_until : null,
  };
}

async function finishJob(sb: any, job: Job, outcome: HandlerOutcome) {
  if (outcome.ok) {
    await sb.from("playlist_operation_queue").update({
      status: "done",
      completed_at: new Date().toISOString(),
      error: null,
    }).eq("id", job.id);
    return { final: "done" as const };
  }

  // playlist_locked → reagenda curto, devolve attempt (--).
  if (outcome.error === "playlist_locked") {
    await sb.from("playlist_operation_queue").update({
      status: "pending",
      claimed_at: null,
      claimed_by: null,
      attempts: Math.max(0, job.attempts - 1),
      scheduled_for: new Date(Date.now() + 30_000).toISOString(),
      error: "playlist_locked (reagendado)",
    }).eq("id", job.id);
    return { final: "rescheduled_lock" as const };
  }

  // Spotify em backoff global: não queima tentativa e reagenda para depois do bloqueio.
  if (outcome.code === "spotify_circuit_open" || outcome.error === "SPOTIFY_CIRCUIT_OPEN") {
    const untilMs = outcome.blocked_until ? new Date(outcome.blocked_until).getTime() : NaN;
    const retryMs = Number.isFinite(untilMs)
      ? Math.max(untilMs + 5 * 60_000, Date.now() + 60_000)
      : Date.now() + Math.max(outcome.retry_after ?? 60, 60) * 1000;
    await sb.from("playlist_operation_queue").update({
      status: "pending",
      claimed_at: null,
      claimed_by: null,
      attempts: Math.max(0, job.attempts - 1),
      scheduled_for: new Date(retryMs).toISOString(),
      error: outcome.blocked_until
        ? `spotify_circuit_open até ${outcome.blocked_until}`
        : `spotify_circuit_open retry_after=${outcome.retry_after ?? 60}s`,
    }).eq("id", job.id);
    return { final: "rescheduled_circuit" as const };
  }

  // Falha real
  if (job.attempts >= job.max_attempts) {
    await sb.from("playlist_operation_queue").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error: outcome.error ?? "unknown",
    }).eq("id", job.id);
    return { final: "failed" as const };
  }

  // Retry com backoff exponencial
  const delaySec = backoffSecondsForAttempt(job.attempts);
  await sb.from("playlist_operation_queue").update({
    status: "pending",
    claimed_at: null,
    claimed_by: null,
    scheduled_for: new Date(Date.now() + delaySec * 1000).toISOString(),
    error: outcome.error ?? null,
  }).eq("id", job.id);
  return { final: "retry" as const };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Reap zombies primeiro
  let zombies = 0;
  try {
    const { data } = await sb.rpc("reap_zombie_playlist_jobs");
    if (typeof data === "number") zombies = data;
  } catch { /* */ }

  const results: any[] = [];
  let processed = 0, done = 0, failed = 0, retried = 0, lockedRescheduled = 0, circuitRescheduled = 0;

  for (let i = 0; i < BATCH_SIZE; i++) {
    const { data: claimed, error: claimErr } = await sb
      .rpc("claim_next_playlist_job", { _claimed_by: WORKER_ID });
    if (claimErr) {
      results.push({ error: claimErr.message });
      break;
    }
    const job: Job | null = Array.isArray(claimed) ? claimed[0] ?? null : claimed ?? null;
    if (!job) break; // nada pra processar

    processed++;
    const outcome = await invokeHandler(job, sb);
    const fin = await finishJob(sb, job, outcome);
    if (fin.final === "done") done++;
    else if (fin.final === "failed") failed++;
    else if (fin.final === "retry") retried++;
    else if (fin.final === "rescheduled_lock") lockedRescheduled++;
    else if (fin.final === "rescheduled_circuit") circuitRescheduled++;

    if (fin.final === "rescheduled_circuit") break;

    // Após DIAGNOSE_ENGINE concluído com sucesso, enfileira BRAIN_CALC (dedupe automático).
    let chained: { op: string; result: typeof brainEnq } | null = null;
    let brainEnq: Awaited<ReturnType<typeof enqueuePlaylistJob>> | null = null;
    if (fin.final === "done" && job.operation_type === "DIAGNOSE_ENGINE") {
      brainEnq = await enqueuePlaylistJob(sb, {
        playlist_id: job.playlist_id,
        operation_type: "BRAIN_CALC",
      });
      chained = { op: "BRAIN_CALC", result: brainEnq };
    }

    results.push({
      id: job.id,
      playlist_id: job.playlist_id,
      op: job.operation_type,
      attempt: job.attempts,
      result: fin.final,
      error: outcome.ok ? null : outcome.error,
      chained,
    });
  }

  // Conta o que ficou pendente pra observabilidade
  const { count: pendingRemaining } = await sb
    .from("playlist_operation_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  await reportCronHealth(sb, {
    job_name: "playlist-queue-processor",
    status: failed > 0 ? "partial" : "ok",
    startedAt,
    metrics: {
      processed,
      done,
      failed,
      retried,
      locked_rescheduled: lockedRescheduled,
      circuit_rescheduled: circuitRescheduled,
      zombies_reaped: zombies,
      pending_remaining: pendingRemaining ?? 0,
    },
    message: `processed=${processed} done=${done} failed=${failed} retried=${retried} locked=${lockedRescheduled} circuit=${circuitRescheduled} pending=${pendingRemaining ?? 0}`,
  });

  return jr({
    ok: true,
    worker: WORKER_ID,
    processed, done, failed, retried,
    locked_rescheduled: lockedRescheduled,
    circuit_rescheduled: circuitRescheduled,
    zombies_reaped: zombies,
    pending_remaining: pendingRemaining ?? 0,
    results,
  });
});
