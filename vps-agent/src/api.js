import { config } from "./config.js";
import { makeLogger } from "./logger.js";

const log = makeLogger("api");

const headers = () => ({
  "x-agent-token": config.OPS_AGENT_TOKEN,
  "content-type": "application/json",
  "user-agent": `nexengine-ops-agent/${config.AGENT_VERSION}`,
});

async function withRetry(fn, { tries = 3, delayMs = 800, label = "request" } = {}) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      log.warn(`${label} falhou (tentativa ${i}/${tries})`, { error: String(e?.message || e) });
      if (i < tries) await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
  throw lastErr;
}

export async function pollCommands(limit = 1) {
  const url = `${config.OPS_BASE}/ops-agent-poll?agent_id=${encodeURIComponent(config.AGENT_ID)}&limit=${limit}`;
  return withRetry(async () => {
    const r = await fetch(url, { headers: headers() });
    if (r.status === 204) return [];
    if (!r.ok) throw new Error(`poll http ${r.status}: ${await r.text().catch(() => "")}`);
    const j = await r.json();
    return Array.isArray(j?.commands) ? j.commands : [];
  }, { label: "poll" });
}

export async function reportCommand(update) {
  return withRetry(async () => {
    const r = await fetch(`${config.OPS_BASE}/ops-agent-report`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ type: "command_update", ...update }),
    });
    if (!r.ok) throw new Error(`report http ${r.status}: ${await r.text().catch(() => "")}`);
    return true;
  }, { label: "report-command" });
}

export async function reportMetrics(metrics, extra = {}) {
  return withRetry(async () => {
    const r = await fetch(`${config.OPS_BASE}/ops-agent-report`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({
        type: "metrics",
        agent_id: config.AGENT_ID,
        bot_name: config.BOT_NAME,
        agent_version: config.AGENT_VERSION,
        metrics,
        extra,
      }),
    });
    if (!r.ok) throw new Error(`metrics http ${r.status}: ${await r.text().catch(() => "")}`);
    return true;
  }, { label: "report-metrics" });
}

export async function reportIncident(incident) {
  // Reaproveita o endpoint de métricas como heartbeat com flag "incident".
  // O painel /sistema já possui pipeline de alertas; aqui só carimba metadata.
  return withRetry(async () => {
    const r = await fetch(`${config.OPS_BASE}/ops-agent-report`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({
        type: "metrics",
        agent_id: config.AGENT_ID,
        bot_name: config.BOT_NAME,
        agent_version: config.AGENT_VERSION,
        message: `incident:${incident.kind}`,
        metrics: {},
        extra: { incident },
      }),
    });
    if (!r.ok) throw new Error(`incident http ${r.status}`);
    return true;
  }, { label: "report-incident", tries: 2 });
}
