// Job: spotify.deal.collect — coleta plays + screenshot da música no S4A.
import { browserPool } from "../playwright/browserPool.js";
import { assertLoggedIn } from "../playwright/spotifySession.js";
import { SELECTORS } from "../playwright/spotifySelectors.js";
import { uploadScreenshot } from "../cloud/uploadPrint.js";
import {
  insertBotEvent, insertDealSnapshot, bumpDealSong, markDealSongError, getDealSong,
} from "../cloud/persistence.js";
import { config } from "../config.js";
import { makeLogger } from "../logger.js";

const log = makeLogger("h:deal.collect");

function parsePlays(txt) {
  if (!txt) return null;
  const clean = String(txt).trim().toLowerCase().replace(/\u00a0/g, " ");
  // suporta "1.234.567", "1,234,567", "1.2M", "1.2k"
  const mult = clean.endsWith("m") ? 1_000_000 : clean.endsWith("k") ? 1_000 : 1;
  const numStr = clean.replace(/[^\d,.\-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(numStr);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * mult);
}

async function safeRead(page, selector) {
  try {
    const loc = page.locator(selector).first();
    if ((await loc.count()) === 0) return null;
    const txt = await loc.innerText({ timeout: 5000 });
    return parsePlays(txt);
  } catch { return null; }
}

function buildSongUrl(song) {
  if (song?.song_spotify_url?.includes("artists.spotify.com")) return song.song_spotify_url;
  if (song?.spotify_track_id) {
    return `${config.SPOTIFY_S4A_BASE.replace(/\/+$/, "")}/song/${song.spotify_track_id}`;
  }
  return null;
}

export async function spotifyDealCollect(job, ctx) {
  const { deal_id, song_id } = job.payload || {};
  if (!deal_id || !song_id) {
    const err = new Error("payload.deal_id e song_id obrigatórios"); err.fatal = true; throw err;
  }

  const song = await getDealSong(song_id);
  if (!song) { const err = new Error(`song ${song_id} não encontrada`); err.fatal = true; throw err; }
  const url = buildSongUrl(song);
  if (!url) { const err = new Error("Sem spotify_track_id nem URL S4A"); err.fatal = true; throw err; }

  const t0 = Date.now();
  let screenshot_url = null;
  let plays_total = null, plays_24h = null, plays_7d = null, plays_28d = null;

  try {
    const out = await browserPool.withPage(async (page) => {
      log.info("coletando deal", { deal_id, song_id, url, attempts: job.attempts });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await assertLoggedIn(page);
      await page.locator(SELECTORS.printArea).first().waitFor({ state: "visible", timeout: 15000 });

      [plays_total, plays_24h, plays_7d, plays_28d] = await Promise.all([
        safeRead(page, SELECTORS.songTotalStreams),
        safeRead(page, SELECTORS.songStreams24h),
        safeRead(page, SELECTORS.songStreams7d),
        safeRead(page, SELECTORS.songStreams28d),
      ]);

      const buf = await page.locator(SELECTORS.printArea).first().screenshot({ type: "png", animations: "disabled" });
      const up = await uploadScreenshot(buf, `deals/${deal_id}/${song_id}/${job.id}.png`);
      return up;
    });
    screenshot_url = out.signed_url;

    if (plays_total == null) {
      // Sem métrica = falha não-fatal (selectors mudaram OU página ainda renderizando)
      throw new Error("plays_total não pôde ser lido (selector songTotalStreams)");
    }

    await insertDealSnapshot({
      deal_id, song_id,
      playlist_id: deal_id, // snapshot de música usa o próprio deal como agregador
      plays: plays_total,
      plays_24h, plays_7d, plays_28d,
      print_url: screenshot_url,
      source: "spotify_for_artists",
      match_method: "worker",
      correlation_id: job.id,
      ai_raw: { url, attempts: job.attempts, worker_id: ctx.workerId },
    });

    await bumpDealSong({
      song_id,
      intervalMinutes: song.auto_collect_interval_minutes ?? 1440,
    });

    await insertBotEvent({
      bot_name: "spotify-artists-worker",
      step: "deal.collect", status: "success",
      worker_id: ctx.workerId, correlation_id: job.id,
      deal_id, song_id, duration_ms: Date.now() - t0,
      url, screenshot_url,
      metadata: { plays_total, plays_24h, plays_7d, plays_28d, attempts: job.attempts },
    });

    return { deal_id, song_id, plays: plays_total, screenshot_url };
  } catch (e) {
    await markDealSongError({ song_id, error: e?.message || e }).catch(() => {});
    await insertBotEvent({
      bot_name: "spotify-artists-worker",
      step: "deal.collect", status: e.fatal ? "fatal" : "error",
      worker_id: ctx.workerId, correlation_id: job.id,
      deal_id, song_id, duration_ms: Date.now() - t0,
      url, message: String(e?.message || e),
      metadata: { attempts: job.attempts, kind: e.kind ?? null },
    }).catch(() => {});
    throw e;
  }
}
