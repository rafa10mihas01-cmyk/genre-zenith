// Healthcheck HTTP runtime — endpoint local para uptime/monitor externo (UptimeRobot, etc)
// e para o próprio Docker HEALTHCHECK.
//
// GET /health   → 200 { ok, uptime, agent_id, pm2_processes:[...], jobs_in_processing }
// GET /metrics  → 200 texto plain estilo Prometheus (basic)
//
// Roda como processo PM2 separado em PORT=HEALTHCHECK_PORT (default 8787).

import http from "node:http";
import os from "node:os";
import { config } from "./config.js";
import { makeLogger } from "./logger.js";
import { collectMetrics } from "./metrics.js";

const log = makeLogger("healthcheck");
const PORT = Number(process.env.HEALTHCHECK_PORT || 8787);
const HOST = process.env.HEALTHCHECK_HOST || "0.0.0.0";
const startedAt = Date.now();

async function pm2Snapshot() {
  try {
    const { execFile } = await import("node:child_process");
    const out = await new Promise((resolve, reject) => {
      execFile("pm2", ["jlist"], { timeout: 5000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
    const list = JSON.parse(out || "[]");
    return list.map((p) => ({
      name: p.name,
      pid: p.pid,
      status: p?.pm2_env?.status,
      restarts: p?.pm2_env?.restart_time,
      uptime_ms: p?.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : null,
      memory_mb: p?.monit?.memory ? Math.round(p.monit.memory / 1024 / 1024) : null,
      cpu: p?.monit?.cpu ?? null,
    }));
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (url === "/health") {
    const m = await collectMetrics().catch(() => ({}));
    const pm2 = await pm2Snapshot();
    const body = {
      ok: true,
      agent_id: config.AGENT_ID,
      hostname: os.hostname(),
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      cpu_percent: m.cpu_percent ?? null,
      mem_percent: m.mem_percent ?? null,
      pm2_processes: pm2,
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  if (url === "/metrics") {
    const m = await collectMetrics().catch(() => ({}));
    const lines = [
      `# HELP nexengine_uptime_seconds Healthcheck uptime`,
      `nexengine_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`,
      `nexengine_cpu_percent ${m.cpu_percent ?? 0}`,
      `nexengine_mem_percent ${m.mem_percent ?? 0}`,
    ];
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    res.end(lines.join("\n") + "\n");
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found\n");
});

server.listen(PORT, HOST, () => {
  log.info("healthcheck pronto", { host: HOST, port: PORT });
});

process.on("SIGINT",  () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
