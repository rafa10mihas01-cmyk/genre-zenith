// Scheduler local — chama periodicamente a edge function `jobs-scheduler`
// que enfileira spotify.deal.collect / spotify.artist.fetch / spotify.print_batch
// respeitando dedupe_key, cooldowns e janelas de auto-coleta.
//
// Frequências (configuráveis via .env):
//   SCHEDULER_MAIN_INTERVAL_MS   — default 5min  (coleta + refresh)
//   SCHEDULER_RETRY_INTERVAL_MS  — default 2min  (reprocessa falhas com backoff)
//   SCHEDULER_PRINT_INTERVAL_MS  — default 15min (print batches pendentes)
//
// Roda como processo PM2 separado (ver ecosystem.config.cjs).

import { config } from "./config.js";
import { makeLogger } from "./logger.js";

const log = makeLogger("scheduler");

const MAIN_MS  = Number(process.env.SCHEDULER_MAIN_INTERVAL_MS  || 5  * 60 * 1000);
const RETRY_MS = Number(process.env.SCHEDULER_RETRY_INTERVAL_MS || 2  * 60 * 1000);
const PRINT_MS = Number(process.env.SCHEDULER_PRINT_INTERVAL_MS || 15 * 60 * 1000);

let stopping = false;

async function callScheduler(scope) {
  try {
    const r = await fetch(`${config.OPS_BASE}/jobs-scheduler`, {
      method: "POST",
      headers: {
        "x-agent-token": config.OPS_AGENT_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ scope, source: "vps-scheduler", agent_id: config.AGENT_ID }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`http ${r.status}: ${text.slice(0, 200)}`);
    const data = text ? JSON.parse(text) : {};
    log.info("tick ok", { scope, ...data });
  } catch (e) {
    log.warn("tick falhou", { scope, error: String(e?.message || e) });
  }
}

function loop(scope, intervalMs) {
  const tick = async () => {
    if (stopping) return;
    await callScheduler(scope);
    if (!stopping) setTimeout(tick, intervalMs);
  };
  // primeiro tick com pequeno jitter para evitar thundering herd entre VPS
  setTimeout(tick, Math.floor(Math.random() * 5000));
}

function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log.warn(`recebido ${sig}, encerrando scheduler`);
  setTimeout(() => process.exit(0), 300);
}

log.info("scheduler iniciando", {
  base: config.OPS_BASE, agent_id: config.AGENT_ID,
  main_ms: MAIN_MS, retry_ms: RETRY_MS, print_ms: PRINT_MS,
});

loop("main",  MAIN_MS);
loop("retry", RETRY_MS);
loop("print", PRINT_MS);

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException",  (e) => log.error("uncaughtException",  { error: String(e?.message || e) }));
process.on("unhandledRejection", (e) => log.error("unhandledRejection", { error: String(e?.message || e) }));
