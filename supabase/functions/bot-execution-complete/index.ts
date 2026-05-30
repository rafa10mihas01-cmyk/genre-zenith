// bot-execution-complete — Bot reporta resultado de execução de playlist OU coleta de song.
// Auth: header x-bot-key.
// POST { job_id?, song_id?, deal_id?, correlation_id, status: 'done'|'failed', error? }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-bot-key, x-bot-token, x-worker-id, x-process-id, x-hostname, x-timer-id, x-bot-name, x-bot-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY") ?? "";
const BOT_INGEST_TOKEN = Deno.env.get("BOT_INGEST_TOKEN") ?? "";

function isAuthorizedBot(req: Request): boolean {
  const candidates = [
    req.headers.get("x-bot-key"),
    req.headers.get("x-bot-token"),
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""),
  ].map((v) => (v ?? "").trim()).filter(Boolean);
  const allowed = [BOT_API_KEY, BOT_INGEST_TOKEN].filter(Boolean);
  return candidates.some((c) => allowed.includes(c));
}

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
  if (!isAuthorizedBot(req)) return jr({ error: "unauthorized" }, 401);
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jr({ error: "invalid_json" }, 400);
  }

  const jobId = body?.job_id;
  const songId = body?.song_id;
  const dealId = body?.deal_id ?? null;
  const status = body?.status;
  const errorMsg = body?.error ?? null;
  const correlationId = body?.correlation_id ?? null;
  const workerId = req.headers.get("x-worker-id") || body?.worker_id || null;
  const botName = req.headers.get("x-bot-name") || "spotify-artists-bot";
  const session = req.headers.get("x-bot-session") || null;

  if ((!jobId && !songId) || !["done", "failed"].includes(status)) {
    return jr({ error: "invalid_input" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const nowIso = new Date().toISOString();

  // Novo ciclo de coleta: o bot encerra a song diretamente, não via playlist_execution_jobs.
  // Isso impede rows de curator_deal_songs ficarem presas em queued quando o bot finaliza sem snapshot.
  if (songId && !jobId) {
    const { data: song, error: songErr } = await supabase
      .from("curator_deal_songs")
      .select("id, deal_id, auto_collect_interval_minutes, queued_at")
      .eq("id", songId)
      .maybeSingle();
    if (songErr || !song) return jr({ error: "song_not_found" }, 404);

    const intervalMin = song.auto_collect_interval_minutes ?? 1440;
    const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();
    const queueAgeMs = song.queued_at ? Date.now() - new Date(song.queued_at).getTime() : null;

    await supabase
      .from("curator_deal_songs")
      .update({
        auto_collect_status: status === "done" ? "idle" : "error",
        auto_collect_error: status === "done" ? null : (errorMsg ?? "bot execution failed"),
        last_auto_collect_at: nowIso,
        next_auto_collect_at: nextAt,
        queued_at: null,
      })
      .eq("id", songId);

    await supabase.from("bot_events").insert({
      bot_name: botName,
      session_id: session,
      deal_id: dealId ?? song.deal_id,
      song_id: songId,
      step: "collect_complete",
      status: status === "done" ? "success" : "error",
      lifecycle_state: status === "done" ? "FINISHED" : "FAILED",
      correlation_id: correlationId,
      worker_id: workerId,
      message: status === "done" ? "collect done" : String(errorMsg ?? "collect failed").slice(0, 500),
      metadata: { queue_age_ms: queueAgeMs, next_auto_collect_at: nextAt },
    });

    return jr({ ok: true, status, song_id: songId, next_auto_collect_at: nextAt });
  }

  const { data: job, error: jobErr } = await supabase
    .from("playlist_execution_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr || !job) return jr({ error: "job_not_found" }, 404);

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
