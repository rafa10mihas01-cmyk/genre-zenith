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

export const claimJob = async (worker_id, job_types, lease_seconds = 300) => {
  const out = await call("jobs-claim", { worker_id, job_types, lease_seconds }, { label: "jobs-claim", tries: 2 });
  // Logar payload bruto quando a fila devolve algo "verdadeiro" mas inválido
  if (out?.job && (!out.job.id || !out.job.job_type)) {
    log.warn("jobs-claim retornou job sem id/type", { raw: JSON.stringify(out).slice(0, 400) });
  }
  return out;
};

export const completeJob = (payload) => {
  if (!payload?.job_id || !payload?.worker_id) {
    const msg = `completeJob abortado — payload inválido (job_id=${payload?.job_id}, worker_id=${payload?.worker_id})`;
    log.error(msg);
    return Promise.reject(new Error(msg));
  }
  return call("jobs-complete", payload, { label: "jobs-complete" });
};

export const heartbeat = (payload) =>
  call("workers-heartbeat", payload, { label: "workers-heartbeat", tries: 2 });
