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

// Backoff exponencial entre tentativas falhas consecutivas de coleta de song.
// attempt 1 → 2min, attempt 2 → 8min, attempt 3 → 30min, attempt 4+ → 2h.
function deal_collect_backoff_ms(attempt: number) {
  const a = Math.max(1, Math.floor(attempt));
  if (a === 1) return 2 * 60_000;
  if (a === 2) return 8 * 60_000;
  if (a === 3) return 30 * 60_000;
  return 120 * 60_000;
}

// Categoriza a mensagem de erro do bot em um code estável.
function classify_error_code(msg: string | null | undefined): string {
  const m = String(msg ?? "").toLowerCase();
  if (!m) return "unknown";
  if (/playlist_breakdown_required|breakdown por playlist/.test(m)) return "breakdown_contract_change";
  if (/nenhuma playlist encontrada no breakdown|no playlists.*breakdown/.test(m)) return "breakdown_empty";
  if (/login|sp_dc|sess(ã|a)o|unauthor/.test(m)) return "session_invalid";
  if (/timeout|timed out|deadline/.test(m)) return "timeout";
  if (/target page|context.*closed|browser has been closed/.test(m)) return "browser_crash";
  if (/captcha|challenge/.test(m)) return "spotify_challenge";
  if (/429|rate.?limit/.test(m)) return "rate_limited";
  return "bot_error";
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
  const explicitSongId = body?.song_id;
  const dealId = body?.deal_id ?? null;
  const status = body?.status;
  const errorMsg = body?.error ?? null;
  const correlationId = body?.correlation_id ?? null;
  const workerId = req.headers.get("x-worker-id") || body?.worker_id || null;
  const botName = req.headers.get("x-bot-name") || "spotify-artists-bot";
  const session = req.headers.get("x-bot-session") || null;

  if ((!jobId && !explicitSongId) || !["done", "failed"].includes(status)) {
    return jr({ error: "invalid_input" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const nowIso = new Date().toISOString();

  // Novo ciclo de coleta: o bot encerra a song diretamente, não via playlist_execution_jobs.
  // Compat: versões antigas do worker enviavam o id da música em `job_id`.
  const completeCollectSong = async (songId: string) => {
    const { data: song, error: songErr } = await supabase
      .from("curator_deal_songs")
      .select("id, deal_id, auto_collect_interval_minutes, queued_at, collect_attempt_count")
      .eq("id", songId)
      .maybeSingle();
    if (songErr || !song) return jr({ error: "song_not_found" }, 404);

    const isBreakdownContractError = status === "failed" && /playlist_breakdown_required|breakdown por playlist/i.test(String(errorMsg ?? ""));
    const queueAgeMs = song.queued_at ? Date.now() - new Date(song.queued_at).getTime() : null;

    let updatePayload: Record<string, unknown>;
    let nextAt: string;
    let attemptCount = Number(song.collect_attempt_count ?? 0);
    let errorCode: string | null = null;

    if (status === "done") {
      // Sucesso: zera tentativas e volta pro intervalo normal.
      const intervalMin = song.auto_collect_interval_minutes ?? 1440;
      nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();
      attemptCount = 0;
      updatePayload = {
        auto_collect_status: "idle",
        auto_collect_error: null,
        last_auto_collect_at: nowIso,
        next_auto_collect_at: nextAt,
        collect_attempt_count: 0,
        collect_error_code: null,
        collect_paused_until: null,
        queued_at: null,
      };
    } else if (isBreakdownContractError) {
      // Contrato breakdown_required: re-enfileira rápido (5min), não conta como falha real.
      nextAt = new Date(Date.now() + 5 * 60_000).toISOString();
      errorCode = "breakdown_contract_change";
      updatePayload = {
        auto_collect_status: "idle",
        auto_collect_error: errorMsg ?? "breakdown_contract_change",
        last_auto_collect_at: nowIso,
        next_auto_collect_at: nextAt,
        collect_error_code: errorCode,
        collect_paused_until: nextAt,
        queued_at: null,
      };
    } else {
      // Falha real: backoff exponencial.
      attemptCount = attemptCount + 1;
      errorCode = classify_error_code(errorMsg);
      const backoff = deal_collect_backoff_ms(attemptCount);
      nextAt = new Date(Date.now() + backoff).toISOString();
      updatePayload = {
        auto_collect_status: "error",
        auto_collect_error: errorMsg ?? "bot execution failed",
        last_auto_collect_at: nowIso,
        next_auto_collect_at: nextAt,
        collect_attempt_count: attemptCount,
        collect_error_code: errorCode,
        collect_paused_until: nextAt,
        queued_at: null,
      };
    }

    await supabase.from("curator_deal_songs").update(updatePayload).eq("id", songId);

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
      metadata: {
        queue_age_ms: queueAgeMs,
        next_auto_collect_at: nextAt,
        attempt_count: attemptCount,
        error_code: errorCode,
      },
    });

    return jr({ ok: true, status, song_id: songId, next_auto_collect_at: nextAt, attempt_count: attemptCount, error_code: errorCode });
  };

  if (explicitSongId && !jobId) {
    return await completeCollectSong(explicitSongId);
  }

  const { data: job, error: jobErr } = await supabase
    .from("playlist_execution_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr || !job) {
    const fallbackSongId = explicitSongId ?? jobId;
    if (fallbackSongId) {
      return await completeCollectSong(fallbackSongId);
    }
    return jr({ error: "job_not_found" }, 404);
  }

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
