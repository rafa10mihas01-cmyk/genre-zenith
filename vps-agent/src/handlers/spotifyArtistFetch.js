// Job: spotify.artist.fetch — abre página do artista no S4A, captura screenshot.
import { browserPool } from "../playwright/browserPool.js";
import { assertLoggedIn } from "../playwright/spotifySession.js";
import { SELECTORS } from "../playwright/spotifySelectors.js";
import { uploadScreenshot } from "../cloud/uploadPrint.js";
import { insertBotEvent } from "../cloud/persistence.js";
import { config } from "../config.js";
import { makeLogger } from "../logger.js";

const log = makeLogger("h:artist.fetch");

export async function spotifyArtistFetch(job, ctx) {
  const { artist_id, spotify_artist_url } = job.payload || {};
  if (!artist_id) {
    const err = new Error("payload.artist_id obrigatório"); err.fatal = true; throw err;
  }
  const url = spotify_artist_url
    ?? `${config.SPOTIFY_S4A_BASE.replace(/\/+$/, "")}/artist/${artist_id}/home`;

  const t0 = Date.now();
  let screenshot_url = null;

  try {
    const result = await browserPool.withPage(async (page) => {
      log.info("navegando", { url, attempts: job.attempts });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await assertLoggedIn(page);
      // Espera a área principal renderizar.
      await page.locator(SELECTORS.printArea).first().waitFor({ state: "visible", timeout: 15000 });
      const target = page.locator(SELECTORS.printArea).first();
      const buf = await target.screenshot({ type: "png", animations: "disabled" });
      const path = `artists/${artist_id}/${job.id}.png`;
      const up = await uploadScreenshot(buf, path);
      return up;
    });
    screenshot_url = result.signed_url;

    await insertBotEvent({
      bot_name: "spotify-artists-worker",
      step: "artist.fetch",
      status: "success",
      worker_id: ctx.workerId,
      correlation_id: job.id,
      duration_ms: Date.now() - t0,
      url, screenshot_url,
      metadata: { artist_id, attempts: job.attempts },
    });

    return { artist_id, screenshot_url, captured_at: new Date().toISOString() };
  } catch (e) {
    await insertBotEvent({
      bot_name: "spotify-artists-worker",
      step: "artist.fetch",
      status: e.fatal ? "fatal" : "error",
      worker_id: ctx.workerId,
      correlation_id: job.id,
      duration_ms: Date.now() - t0,
      url, message: String(e?.message || e),
      metadata: { artist_id, attempts: job.attempts, kind: e.kind ?? null },
    }).catch(() => {});
    throw e;
  }
}
