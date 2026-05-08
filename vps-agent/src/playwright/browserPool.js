/**
 * Browser pool — 1 Chromium persistente por worker, reutilizado entre jobs.
 *
 * Garantias:
 *  - context/page são SEMPRE fechados no `finally` (sem leak).
 *  - Reciclagem após N jobs ou X minutos (config.BROWSER_RECYCLE_*).
 *  - `getActivityAge()` permite ao watchdog detectar pool travado.
 *  - `dispose()` limpa Chromium em SIGTERM.
 *
 * Sessão: usa `storageState` em SPOTIFY_STORAGE_STATE_PATH (cookies+localStorage).
 */
import fs from "node:fs";
import { chromium } from "playwright";
import { config } from "../config.js";
import { makeLogger } from "../logger.js";

const log = makeLogger("browser-pool");

class BrowserPool {
  constructor() {
    this.browser = null;
    this.context = null;
    this.jobsServed = 0;
    this.createdAt = 0;
    this.busy = false;
    this.lastActivityAt = Date.now();
  }

  async _create() {
    log.info("iniciando Chromium", { headless: config.PLAYWRIGHT_HEADLESS });
    this.browser = await chromium.launch({
      headless: config.PLAYWRIGHT_HEADLESS,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", "--disable-gpu",
        "--disable-features=IsolateOrigins,site-per-process",
        "--no-zygote",
      ],
    });

    let storageState;
    if (config.SPOTIFY_STORAGE_STATE_PATH && fs.existsSync(config.SPOTIFY_STORAGE_STATE_PATH)) {
      try {
        storageState = JSON.parse(fs.readFileSync(config.SPOTIFY_STORAGE_STATE_PATH, "utf8"));
        log.info("storageState carregado", { path: config.SPOTIFY_STORAGE_STATE_PATH });
      } catch (e) {
        log.error("storageState inválido", { error: String(e?.message || e) });
      }
    } else {
      log.warn("storageState ausente — assertLoggedIn vai falhar", { path: config.SPOTIFY_STORAGE_STATE_PATH });
    }

    this.context = await this.browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/124.0.0.0 Safari/537.36",
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
    });
    this.context.setDefaultNavigationTimeout(config.PLAYWRIGHT_NAV_TIMEOUT_MS);
    this.context.setDefaultTimeout(config.PLAYWRIGHT_ACTION_TIMEOUT_MS);

    this.createdAt = Date.now();
    this.jobsServed = 0;
  }

  async _ensure() {
    const tooOld = this.createdAt && Date.now() - this.createdAt > config.BROWSER_RECYCLE_AFTER_MIN * 60_000;
    const tooMany = this.jobsServed >= config.BROWSER_RECYCLE_AFTER_JOBS;
    if (this.browser && (tooOld || tooMany)) {
      log.info("reciclando Chromium", { tooOld, tooMany, jobsServed: this.jobsServed });
      await this.dispose();
    }
    if (!this.browser) await this._create();
  }

  async withPage(fn) {
    await this._ensure();
    this.busy = true;
    this.lastActivityAt = Date.now();
    let page;
    try {
      page = await this.context.newPage();
      const out = await fn(page);
      this.jobsServed++;
      this.lastActivityAt = Date.now();
      return out;
    } finally {
      this.busy = false;
      this.lastActivityAt = Date.now();
      if (page) {
        try { await page.close({ runBeforeUnload: false }); } catch {}
      }
    }
  }

  getActivityAgeMs() { return Date.now() - this.lastActivityAt; }
  isBusy() { return this.busy; }

  async dispose() {
    try { if (this.context) await this.context.close(); } catch {}
    try { if (this.browser) await this.browser.close(); } catch {}
    this.context = null; this.browser = null; this.createdAt = 0;
  }
}

export const browserPool = new BrowserPool();
