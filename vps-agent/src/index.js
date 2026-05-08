import { config } from "./config.js";
import { makeLogger } from "./logger.js";
import { pollCommands, reportCommand, reportMetrics } from "./api.js";
import { collectMetrics } from "./metrics.js";
import { executeCommand } from "./executor.js";
import { watchdog } from "./watchdog.js";

const log = makeLogger("agent");
let stopping = false;

function startInterval(name, fn, ms) {
  let running = false;
  const tick = async () => {
    if (stopping || running) return;
    running = true;
    try { await fn(); }
    catch (e) { log.error(`${name} crash`, { error: String(e?.message || e) }); }
    finally { running = false; }
  };
  tick();
  return setInterval(tick, ms);
}

async function pollLoop() {
  let cmds = [];
  try { cmds = await pollCommands(1); }
  catch (e) { log.warn("poll erro (silencioso)", { error: String(e?.message || e) }); return; }
  if (!cmds.length) return;
  for (const cmd of cmds) {
    log.info("comando recebido", { id: cmd.id, kind: cmd.kind, command: cmd.command });
    try { await reportCommand({ command_id: cmd.id, status: "running", started_at: new Date().toISOString() }); } catch {}
    const ctx = { collectMetrics, watchdog };
    let res;
    try { res = await executeCommand(cmd, ctx); }
    catch (e) {
      res = { ok: false, stderr: String(e?.message || e), exit_code: 1, stdout: "", duration_ms: 0, started_at: new Date().toISOString(), finished_at: new Date().toISOString() };
    }
    try {
      await reportCommand({
        command_id: cmd.id,
        status: res.ok ? "success" : (res.timeout ? "timeout" : "error"),
        stdout: res.stdout?.slice(0, 90_000) ?? "",
        stderr: res.stderr?.slice(0, 90_000) ?? "",
        exit_code: res.exit_code,
        started_at: res.started_at,
        finished_at: res.finished_at,
        duration_ms: res.duration_ms,
      });
    } catch (e) {
      log.error("falha ao reportar comando", { id: cmd.id, error: String(e?.message || e) });
    }
  }
}

async function metricsLoop() {
  const m = await collectMetrics();
  await reportMetrics(m);
}

async function watchdogLoop() {
  await watchdog.tick();
}

async function main() {
  log.info("nexengine-ops-agent iniciando", {
    agent_id: config.AGENT_ID, version: config.AGENT_VERSION,
    base: config.OPS_BASE, docker: config.DOCKER_ENABLED,
    spotify_bot: config.SPOTIFY_BOT_PM2_NAME,
  });

  // Healthcheck inicial: garante que conectividade está OK antes de continuar.
  try { await pollCommands(0); log.info("conectividade com Cloud OK"); }
  catch (e) { log.error("não foi possível alcançar Cloud no boot", { error: String(e?.message || e) }); }

  const i1 = startInterval("poll",      pollLoop,      config.POLL_INTERVAL_MS);
  const i2 = startInterval("metrics",   metricsLoop,   config.METRICS_INTERVAL_MS);
  const i3 = startInterval("watchdog",  watchdogLoop,  config.HEALTHCHECK_INTERVAL_MS);

  const shutdown = async (sig) => {
    if (stopping) return;
    stopping = true;
    log.warn(`recebido ${sig}, encerrando`);
    clearInterval(i1); clearInterval(i2); clearInterval(i3);
    setTimeout(() => process.exit(0), 800);
  };
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException",  (e) => log.error("uncaughtException",  { error: String(e?.message || e) }));
  process.on("unhandledRejection", (e) => log.error("unhandledRejection", { error: String(e?.message || e) }));
}

main().catch((e) => { log.error("fatal no boot", { error: String(e?.message || e) }); process.exit(1); });
