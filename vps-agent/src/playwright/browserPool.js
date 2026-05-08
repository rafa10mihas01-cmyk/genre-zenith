/**
 * Browser pool — Chromium persistente com stealth hardening (anti-headless detection).
 *
 * Stack:
 *  - playwright-extra + puppeteer-extra-plugin-stealth → mascara `navigator.webdriver`,
 *    plugins, languages, chrome runtime, permissions, WebGL vendor, etc.
 *  - Fingerprint estável: UA, locale, timezone, viewport, deviceScaleFactor.
 *  - Launch flags hardening: remove `--enable-automation`, ignora prefs default.
 *  - Reciclagem (jobs/min) e detecção de pool travado mantidas.
 */
import fs from "node:fs";
import { chromium as rawChromium } from "playwright";
import { chromium as extraChromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { config } from "../config.js";
import { makeLogger } from "../logger.js";

const log = makeLogger("browser-pool");

// Aplica stealth uma vez (idempotente).
let stealthApplied = false;
function ensureStealth() {
  if (stealthApplied) return;
  try {
    extraChromium.use(StealthPlugin());
    stealthApplied = true;
    log.info("playwright-extra stealth aplicado");
  } catch (e) {
    log.error("falha ao aplicar stealth, caindo no chromium puro", { error: String(e?.message || e) });
  }
}

const STEALTH_UA =
  process.env.PLAYWRIGHT_USER_AGENT?.trim() ||
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const VIEWPORT = {
  width: Number(process.env.PLAYWRIGHT_VIEWPORT_W) || 1440,
  height: Number(process.env.PLAYWRIGHT_VIEWPORT_H) || 900,
};
const DPR = Number(process.env.PLAYWRIGHT_DPR) || 2;
const LOCALE = process.env.PLAYWRIGHT_LOCALE?.trim() || "pt-BR";
const TZ = process.env.PLAYWRIGHT_TZ?.trim() || "America/Sao_Paulo";

const HARDENED_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-features=IsolateOrigins,site-per-process,AutomationControlled",
  "--disable-blink-features=AutomationControlled",
  "--no-zygote",
  "--disable-infobars",
  "--disable-extensions-except=",
  "--disable-default-apps",
  "--no-first-run",
  "--no-default-browser-check",
  "--password-store=basic",
  "--use-mock-keychain",
  "--lang=pt-BR",
];

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
    const legacy = config.PLAYWRIGHT_LEGACY_MODE;
    if (!legacy) ensureStealth();
    const launcher = (!legacy && stealthApplied) ? extraChromium : rawChromium;
    log.info("iniciando Chromium", {
      mode: legacy ? "LEGACY" : "stealth",
      headless: config.PLAYWRIGHT_HEADLESS,
      stealth: !legacy && stealthApplied,
      viewport: VIEWPORT,
      tz: TZ,
      locale: LOCALE,
    });

    const legacyArgs = [
      "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", "--disable-gpu",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-zygote",
    ];

    this.browser = await launcher.launch({
      headless: config.PLAYWRIGHT_HEADLESS,
      args: legacy ? legacyArgs : HARDENED_ARGS,
      ...(legacy ? {} : { ignoreDefaultArgs: ["--enable-automation"], chromiumSandbox: false }),
    });

    let storageState;
    if (config.SPOTIFY_STORAGE_STATE_PATH && fs.existsSync(config.SPOTIFY_STORAGE_STATE_PATH)) {
      try {
        storageState = JSON.parse(fs.readFileSync(config.SPOTIFY_STORAGE_STATE_PATH, "utf8"));
        const cookies = Array.isArray(storageState.cookies) ? storageState.cookies.length : 0;
        log.info("storageState carregado", { path: config.SPOTIFY_STORAGE_STATE_PATH, cookies });
        if (!cookies) log.warn("storageState sem cookies — login certamente vai falhar");
      } catch (e) {
        log.error("storageState inválido", { error: String(e?.message || e) });
      }
    } else {
      log.warn("storageState ausente — assertLoggedIn vai falhar", { path: config.SPOTIFY_STORAGE_STATE_PATH });
    }

    const LEGACY_UA =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    this.context = await this.browser.newContext(
      legacy
        ? {
            storageState,
            viewport: { width: 1440, height: 900 },
            userAgent: LEGACY_UA,
            locale: "pt-BR",
            timezoneId: "America/Sao_Paulo",
          }
        : {
            storageState,
            viewport: VIEWPORT,
            deviceScaleFactor: DPR,
            userAgent: STEALTH_UA,
            locale: LOCALE,
            timezoneId: TZ,
            colorScheme: "dark",
            reducedMotion: "no-preference",
            isMobile: false,
            hasTouch: false,
            javaScriptEnabled: true,
            bypassCSP: false,
            extraHTTPHeaders: { "Accept-Language": `${LOCALE},pt;q=0.9,en;q=0.8` },
          }
    );
    this.context.setDefaultNavigationTimeout(config.PLAYWRIGHT_NAV_TIMEOUT_MS);
    this.context.setDefaultTimeout(config.PLAYWRIGHT_ACTION_TIMEOUT_MS);

    // Patch extra (defesa em profundidade) — DESABILITADO em LEGACY_MODE.
    if (!legacy) {
      await this.context.addInitScript(() => {
        try {
          Object.defineProperty(navigator, "webdriver", { get: () => undefined });
          Object.defineProperty(navigator, "languages", { get: () => ["pt-BR", "pt", "en-US", "en"] });
          Object.defineProperty(navigator, "plugins", {
            get: () => [1, 2, 3, 4, 5].map(() => ({ name: "Chromium PDF Plugin" })),
          });
          Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
          Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
          // @ts-ignore
          window.chrome = window.chrome || { runtime: {}, app: {}, csi: () => {}, loadTimes: () => {} };
          const origQuery = window.navigator.permissions?.query;
          if (origQuery) {
            window.navigator.permissions.query = (p) =>
              p && p.name === "notifications"
                ? Promise.resolve({ state: Notification.permission })
                : origQuery(p);
          }
          const getParam = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function (p) {
            if (p === 37445) return "Intel Inc.";
            if (p === 37446) return "Intel Iris OpenGL Engine";
            return getParam.call(this, p);
          };
          try { Object.defineProperty(Notification, "permission", { get: () => "default" }); } catch {}
        } catch {}
      });
    }

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
    // Precheck de cookies — uma vez por contexto. Se faltar sp_dc, sinaliza warn
    // mas não bloqueia (assertLoggedIn captura o erro com screenshot).
    if (!this._cookiesChecked) {
      this._cookiesChecked = true;
      try {
        const cookies = await this.context.cookies("https://artists.spotify.com");
        const required = ["sp_dc", "sp_t", "sp_key"];
        const present = required.filter((n) => cookies.some((c) => c.name === n));
        if (present.length === 0) {
          log.error("precheck: NENHUM cookie de sessão Spotify (sp_dc/sp_t/sp_key) — login vai falhar");
        } else {
          log.info("precheck cookies", { present, total: cookies.length });
        }
      } catch (e) {
        log.warn("precheck cookies falhou", { error: String(e?.message || e) });
      }
    }
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

  /** Captura screenshot full-page p/ debug de auth fail. Retorna Buffer ou null. */
  async captureDebug(page, label = "auth-fail") {
    try {
      return await page.screenshot({ type: "png", fullPage: true });
    } catch (e) {
      log.warn("captureDebug falhou", { label, error: String(e?.message || e) });
      return null;
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
