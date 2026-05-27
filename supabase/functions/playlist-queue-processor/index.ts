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
    body: (j) => ({ playlist_id: j.playlist_id, skip_ai: true, source: "queue", ...j.payload }),
  },
};

async function invokeHandler(job: Job): Promise<{ ok: boolean; error?: string }> {
  const handler = HANDLERS[job.operation_type];
  if (!handler) return { ok: false, error: `no_handler:${job.operation_type}` };

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
      body: JSON.stringify(handler.body(job)),
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
  return { ok: false, error: parsed?.error ?? `http_${resp.status}: ${txt.slice(0, 200)}` };
}

async function finishJob(sb: any, job: Job, outcome: { ok: boolean; error?: string }) {
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
  let processed = 0, done = 0, failed = 0, retried = 0, lockedRescheduled = 0;

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
    const outcome = await invokeHandler(job);
    const fin = await finishJob(sb, job, outcome);
    if (fin.final === "done") done++;
    else if (fin.final === "failed") failed++;
    else if (fin.final === "retry") retried++;
    else if (fin.final === "rescheduled_lock") lockedRescheduled++;

    results.push({
      id: job.id,
      playlist_id: job.playlist_id,
      op: job.operation_type,
      attempt: job.attempts,
      result: fin.final,
      error: outcome.ok ? null : outcome.error,
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
      zombies_reaped: zombies,
      pending_remaining: pendingRemaining ?? 0,
    },
    message: `processed=${processed} done=${done} failed=${failed} retried=${retried} locked=${lockedRescheduled} pending=${pendingRemaining ?? 0}`,
  });

  return jr({
    ok: true,
    worker: WORKER_ID,
    processed, done, failed, retried,
    locked_rescheduled: lockedRescheduled,
    zombies_reaped: zombies,
    pending_remaining: pendingRemaining ?? 0,
    results,
  });
});
