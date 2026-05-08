// Cliente HTTP do worker-bridge — única ponte do worker com o Cloud.
// NÃO usa SUPABASE_SERVICE_ROLE_KEY. Apenas OPS_BASE + OPS_AGENT_TOKEN.
import { config } from "../config.js";
import { makeLogger } from "../logger.js";

const log = makeLogger("bridge");

async function call(op, payload = {}, { tries = 3, label = op } = {}) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(`${config.OPS_BASE}/worker-bridge`, {
        method: "POST",
        headers: {
          "x-agent-token": config.OPS_AGENT_TOKEN,
          "content-type": "application/json",
          "user-agent": `nexengine-worker/${config.AGENT_VERSION}`,
        },
        body: JSON.stringify({ op, ...payload }),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`http ${r.status}: ${text.slice(0, 250)}`);
      return text ? JSON.parse(text) : {};
    } catch (e) {
      lastErr = e;
      log.warn(`${label} falhou (${i}/${tries})`, { error: String(e?.message || e) });
      if (i < tries) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw lastErr;
}

export const bridge = {
  insertBotEvent: (payload) => call("bot_event", { payload }),
  insertDealSnapshot: (payload) => call("deal_snapshot", { payload }),
  bumpDealSong: ({ song_id, intervalMinutes }) =>
    call("deal_song_bump", { song_id, interval_minutes: intervalMinutes }),
  markDealSongError: ({ song_id, error }) =>
    call("deal_song_error", { song_id, error: String(error ?? "unknown") }),
  getDealSong: async (song_id) => (await call("deal_song_get", { song_id }))?.song ?? null,
  getPrintBatch: async (batch_id) => (await call("print_batch_get", { batch_id }))?.batch ?? null,
  updatePrintBatch: (batch_id, patch) => call("print_batch_update", { batch_id, patch }),
  uploadPrint: async (path, buffer) => {
    const content_base64 = Buffer.from(buffer).toString("base64");
    const r = await call("upload_print", { path, content_base64 }, { tries: 2 });
    return { path: r.path, signed_url: r.signed_url ?? null };
  },
};
