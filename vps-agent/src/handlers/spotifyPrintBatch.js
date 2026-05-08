// Job: spotify.print_batch — captura prints (1 por item do dom_payload do batch).
import { browserPool } from "../playwright/browserPool.js";
import { assertLoggedIn } from "../playwright/spotifySession.js";
import { SELECTORS } from "../playwright/spotifySelectors.js";
import { uploadScreenshot } from "../cloud/uploadPrint.js";
import { insertBotEvent, getPrintBatch, updatePrintBatch } from "../cloud/persistence.js";
import { config } from "../config.js";
import { makeLogger } from "../logger.js";

const log = makeLogger("h:print_batch");

export async function spotifyPrintBatch(job, ctx) {
  const { deal_id, batch_id } = job.payload || {};
  if (!batch_id) { const err = new Error("payload.batch_id obrigatório"); err.fatal = true; throw err; }

  const batch = await getPrintBatch(batch_id);
  if (!batch) { const err = new Error(`batch ${batch_id} não existe`); err.fatal = true; throw err; }
  if (batch.status === "completed") return { batch_id, skipped: "already_completed" };

  const items = Array.isArray(batch.dom_payload) ? batch.dom_payload : [];
  if (!items.length) { const err = new Error("batch.dom_payload vazio"); err.fatal = true; throw err; }

  const t0 = Date.now();
  await updatePrintBatch(batch_id, { status: "processing", processed_at: new Date().toISOString() });
  const print_paths = []; const print_urls = [];

  try {
    await browserPool.withPage(async (page) => {
      // Login só uma vez por batch
      const home = `${config.SPOTIFY_S4A_BASE.replace(/\/+$/, "")}/c/`;
      await page.goto(home, { waitUntil: "domcontentloaded" });
      await assertLoggedIn(page);

      for (let i = 0; i < items.length; i++) {
        const item = items[i] || {};
        const url = item.url ?? item.href;
        if (!url) { log.warn("item sem url", { i }); continue; }
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.locator(SELECTORS.printArea).first().waitFor({ state: "visible", timeout: 15000 });
        const buf = await page.locator(SELECTORS.printArea).first().screenshot({ type: "png", animations: "disabled" });
        const path = `batches/${deal_id ?? "no-deal"}/${batch_id}/${String(i).padStart(3, "0")}.png`;
        const up = await uploadScreenshot(buf, path);
        print_paths.push(path);
        if (up.signed_url) print_urls.push(up.signed_url);

        // atualiza progressivo (visível no painel)
        await updatePrintBatch(batch_id, {
          received_parts: i + 1,
          print_paths, print_urls,
        });
      }
    });

    await updatePrintBatch(batch_id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      received_parts: items.length,
    });

    await insertBotEvent({
      bot_name: "spotify-artists-worker",
      step: "print_batch", status: "success",
      worker_id: ctx.workerId, correlation_id: job.id,
      deal_id, duration_ms: Date.now() - t0,
      metadata: { batch_id, parts: items.length },
    });

    return { batch_id, parts: items.length, print_urls };
  } catch (e) {
    await updatePrintBatch(batch_id, {
      status: "error",
      error: String(e?.message || e).slice(0, 500),
    }).catch(() => {});
    await insertBotEvent({
      bot_name: "spotify-artists-worker",
      step: "print_batch", status: e.fatal ? "fatal" : "error",
      worker_id: ctx.workerId, correlation_id: job.id,
      deal_id, duration_ms: Date.now() - t0,
      message: String(e?.message || e),
      metadata: { batch_id, kind: e.kind ?? null },
    }).catch(() => {});
    throw e;
  }
}
