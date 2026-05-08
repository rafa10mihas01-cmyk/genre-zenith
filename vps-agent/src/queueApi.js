import { config } from "./config.js";
import { makeLogger } from "./logger.js";

const log = makeLogger("queue-api");

const headers = () => ({
  "x-agent-token": config.OPS_AGENT_TOKEN,
  "content-type": "application/json",
  "user-agent": `nexengine-worker/${config.AGENT_VERSION}`,
});

async function call(path, body, { tries = 3, label = path } = {}) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(`${config.OPS_BASE}/${path}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body ?? {}),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`http ${r.status}: ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : {};
    } catch (e) {
      lastErr = e;
      log.warn(`${label} falhou (${i}/${tries})`, { error: String(e?.message || e) });
      if (i < tries) await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
  throw lastErr;
}

export const claimJob = (worker_id, job_types, lease_seconds = 300) =>
  call("jobs-claim", { worker_id, job_types, lease_seconds }, { label: "jobs-claim", tries: 2 });

export const completeJob = (payload) =>
  call("jobs-complete", payload, { label: "jobs-complete" });

export const heartbeat = (payload) =>
  call("workers-heartbeat", payload, { label: "workers-heartbeat", tries: 2 });
