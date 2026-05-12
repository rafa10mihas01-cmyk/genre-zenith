// bot-execution-complete — Bot reporta resultado de uma tarefa de execução.
// Auth: header x-bot-key.
// POST { job_id, correlation_id, status: 'done'|'failed', error? }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, x-bot-key, x-worker-id, x-process-id, x-hostname, x-timer-id, x-bot-name, x-bot-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;

// Backoff exponencial entre tentativas: 2min, 8min, 30min...
function backoffMs(attempt: number) {
  return Math.min(2 * 60_000 * Math.pow(4, Math.max(0, attempt - 1)), 60 * 60_000);
}

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.headers.get("x-bot-key") !== BOT_API_KEY) return jr({ error: "unauthorized" }, 401);
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jr({ error: "invalid_json" }, 400);
  }

  const jobId = body?.job_id;
  const status = body?.status;
  const errorMsg = body?.error ?? null;
  const correlationId = body?.correlation_id ?? null;
  const workerId = req.headers.get("x-worker-id") || body?.worker_id || null;
  const botName = req.headers.get("x-bot-name") || "spotify-artists-bot";
  const session = req.headers.get("x-bot-session") || null;

  if (!jobId || !["done", "failed"].includes(status)) {
    return jr({ error: "invalid_input" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: job, error: jobErr } = await supabase
    .from("playlist_execution_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr || !job) return jr({ error: "job_not_found" }, 404);

  const nowIso = new Date().toISOString();

  if (status === "done") {
    await supabase
      .from("playlist_execution_jobs")
      .update({
        status: "done",
        last_error: null,
        completed_at: nowIso,
        lease_expires_at: null,
      })
      .eq("id", jobId);

    // Marca allocation como live (mantém o status existente se já for live/ended)
    if (job.allocation_id) {
      await supabase
        .from("campaign_allocations")
        .update({ status: "live" })
        .eq("id", job.allocation_id)
        .in("status", ["suggested", "approved", "active", "pending"]);
    }

    await supabase.from("bot_events").insert({
      bot_name: botName,
      session_id: session,
      step: "execution_complete",
      status: "success",
      lifecycle_state: "FINISHED",
      correlation_id: correlationId ?? job.correlation_id,
      worker_id: workerId,
      message: `${job.job_type} done`,
      metadata: { job_id: jobId, allocation_id: job.allocation_id },
    });

    return jr({ ok: true, status: "done" });
  }

  // status === 'failed'
  const willRetry = job.attempts < job.max_attempts;
  const nextStatus = willRetry ? "pending" : "failed";
  const scheduled = willRetry
    ? new Date(Date.now() + backoffMs(job.attempts)).toISOString()
    : job.scheduled_for;

  await supabase
    .from("playlist_execution_jobs")
    .update({
      status: nextStatus,
      last_error: errorMsg,
      claimed_by: null,
      claimed_at: null,
      lease_expires_at: null,
      scheduled_for: scheduled,
      completed_at: willRetry ? null : nowIso,
    })
    .eq("id", jobId);

  await supabase.from("bot_events").insert({
    bot_name: botName,
    session_id: session,
    step: "execution_complete",
    status: willRetry ? "warning" : "error",
    lifecycle_state: "FAILED",
    correlation_id: correlationId ?? job.correlation_id,
    worker_id: workerId,
    message: errorMsg ? String(errorMsg).slice(0, 500) : "execution failed",
    metadata: { job_id: jobId, attempt: job.attempts, will_retry: willRetry },
  });

  return jr({ ok: true, status: nextStatus, will_retry: willRetry });
});
