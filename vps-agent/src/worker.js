// Worker — consome jobs_queue, executa handlers, heartbeat, healthcheck local.
import os from "node:os";
import { config } from "./config.js";
import { makeLogger } from "./logger.js";
import { claimJob, completeJob, heartbeat } from "./queueApi.js";
import { collectMetrics } from "./metrics.js";
import { handlers, supportedJobTypes } from "./handlers/index.js";
import { browserPool } from "./playwright/browserPool.js";
import { JobTimeoutError } from "./playwright/errors.js";
import { reportIncident } from "./api.js";

const WORKER_INDEX = process.env.WORKER_INDEX || "0";
const WORKER_ID = `${config.AGENT_ID}#w${WORKER_INDEX}`;
const WORKER_KIND = process.env.WORKER_KIND || "spotify-artists-worker";
const LEASE_SECONDS = Number(process.env.WORKER_LEASE_SECONDS || 300);
const IDLE_SLEEP_MS = Number(process.env.WORKER_IDLE_SLEEP_MS || 2000);
const HEARTBEAT_MS = Number(process.env.WORKER_HEARTBEAT_MS || 15000);
const JOB_TYPES = (process.env.WORKER_JOB_TYPES || supportedJobTypes.join(","))
  .split(",").map((s) => s.trim()).filter(Boolean);

const log = makeLogger(`worker:${WORKER_ID}`);
const startedAt = Date.now();
const stats = { completed: 0, failed: 0, current_job_id: null, current_job_type: null, status: "idle", current_started_at: null };
let stopping = false;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new JobTimeoutError(ms)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function sendHeartbeat() {
  try {
    const m = await collectMetrics().catch(() => ({}));
    await heartbeat({
      worker_id: WORKER_ID, worker_kind: WORKER_KIND,
      hostname: os.hostname(), pid: String(process.pid),
      status: stats.status,
      current_job_id: stats.current_job_id, current_job_type: stats.current_job_type,
      jobs_completed: stats.completed, jobs_failed: stats.failed,
      cpu_percent: m.cpu_percent ?? null, mem_percent: m.mem_percent ?? null,
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
      agent_version: config.AGENT_VERSION,
      metadata: {
        job_types: JOB_TYPES, agent_id: config.AGENT_ID,
        rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        browser_busy: browserPool.isBusy(),
        browser_idle_ms: browserPool.getActivityAgeMs(),
      },
    });
  } catch (e) {
    log.warn("heartbeat falhou", { error: String(e?.message || e) });
  }
}

async function localHealthcheck() {
  // Memória: se RSS estourou, encerra (PM2 reinicia) e emite incidente.
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  if (rssMb > config.WORKER_MEMORY_LIMIT_MB) {
    log.error("memória estourada — encerrando", { rssMb, limit: config.WORKER_MEMORY_LIMIT_MB });
    await reportIncident({ kind: "worker_memory_high", severity: "high", worker_id: WORKER_ID, rss_mb: rssMb }).catch(() => {});
    await browserPool.dispose().catch(() => {});
    process.exit(1);
  }
  // Browser travado: pool ocupado há > BROWSER_STUCK_AFTER_MS.
  if (browserPool.isBusy() && browserPool.getActivityAgeMs() > config.BROWSER_STUCK_AFTER_MS) {
    log.error("browser pool travado — reciclando", { idle_ms: browserPool.getActivityAgeMs() });
    await reportIncident({ kind: "browser_stuck", severity: "high", worker_id: WORKER_ID }).catch(() => {});
    await browserPool.dispose().catch(() => {});
  }
}

async function processOne() {
  let claim;
  try {
    claim = await claimJob(WORKER_ID, JOB_TYPES, LEASE_SECONDS);
  } catch (e) {
    log.warn("claim falhou", { error: String(e?.message || e) });
    return false;
  }
  const job = claim?.job;
  if (!job) return false;

  // Guard rail: payload pode vir malformado (id/type nulos) se a RPC retornar
  // shape inesperado. NUNCA chamar complete() sem job.id válido.
  if (!job.id || !job.job_type) {
    log.warn("job inválido recebido (id/type nulos) — ignorando", {
      raw_claim: JSON.stringify(claim).slice(0, 500),
    });
    // Pequeno backoff p/ evitar loop quente caso a RPC esteja repetindo lixo.
    await new Promise((r) => setTimeout(r, 1500));
    return false;
  }

  stats.status = "busy";
  stats.current_job_id = job.id;
  stats.current_job_type = job.job_type;
  stats.current_started_at = Date.now();
  log.info("job claimed", { id: job.id, type: job.job_type, attempts: job.attempts });

  const handler = handlers[job.job_type];
  const startedAtIso = new Date().toISOString();

  if (!handler) {
    log.error("sem handler para job_type", { type: job.job_type });
    try {
      await completeJob({
        job_id: job.id, worker_id: WORKER_ID, status: "failed",
        error: `no handler for ${job.job_type}`, force_dead: true,
        started_at: startedAtIso, finished_at: new Date().toISOString(),
      });
    } catch (e) { log.error("complete(no-handler) falhou", { error: String(e?.message || e) }); }
    stats.failed++;
  } else {
    try {
      const result = await withTimeout(
        handler(job, { workerId: WORKER_ID }),
        config.JOB_TIMEOUT_MS
      );
      await completeJob({
        job_id: job.id, worker_id: WORKER_ID, status: "completed",
        result: result ?? {}, started_at: startedAtIso, finished_at: new Date().toISOString(),
      });
      stats.completed++;
      log.info("job ok", { id: job.id, dur_ms: Date.now() - stats.current_started_at });
    } catch (e) {
      const fatal = e?.fatal === true;
      log.error("job falhou", { id: job.id, kind: e?.kind, error: String(e?.message || e), fatal });
      try {
        await completeJob({
          job_id: job.id, worker_id: WORKER_ID, status: "failed",
          error: String(e?.message || e).slice(0, 2000),
          force_dead: fatal,
          started_at: startedAtIso, finished_at: new Date().toISOString(),
        });
      } catch (e2) { log.error("complete(fail) falhou", { error: String(e2?.message || e2) }); }
      stats.failed++;
      if (e?.kind) {
        await reportIncident({
          kind: e.kind, severity: fatal ? "high" : "medium",
          worker_id: WORKER_ID, job_id: job.id, job_type: job.job_type,
          error: String(e?.message || e).slice(0, 500),
        }).catch(() => {});
      }
    }
  }

  stats.status = "idle";
  stats.current_job_id = null;
  stats.current_job_type = null;
  stats.current_started_at = null;
  return true;
}

async function main() {
  log.info("worker iniciando", {
    worker_id: WORKER_ID, kind: WORKER_KIND, job_types: JOB_TYPES,
    base: config.OPS_BASE, lease_s: LEASE_SECONDS,
    job_timeout_ms: config.JOB_TIMEOUT_MS,
  });

  await sendHeartbeat();
  const hbTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
  const hcTimer = setInterval(() => { localHealthcheck().catch(() => {}); }, 30_000);

  const shutdown = async (sig) => {
    if (stopping) return;
    stopping = true;
    log.warn(`recebido ${sig}, encerrando`);
    stats.status = "offline";
    clearInterval(hbTimer); clearInterval(hcTimer);
    try { await sendHeartbeat(); } catch {}
    try { await browserPool.dispose(); } catch {}
    setTimeout(() => process.exit(0), 800);
  };
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException",  (e) => log.error("uncaughtException",  { error: String(e?.message || e) }));
  process.on("unhandledRejection", (e) => log.error("unhandledRejection", { error: String(e?.message || e) }));

  while (!stopping) {
    const did = await processOne();
    if (!did) await new Promise((r) => setTimeout(r, IDLE_SLEEP_MS));
  }
}

main().catch((e) => {
  log.error("fatal no boot do worker", { error: String(e?.message || e) });
  process.exit(1);
});
