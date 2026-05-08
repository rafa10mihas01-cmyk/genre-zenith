// Validação de sessão Spotify for Artists com detector multi-sinal e debug print on fail.
import { config } from "../config.js";
import { SELECTORS } from "./spotifySelectors.js";
import {
  SpotifyAuthError, SpotifyCaptchaError, SpotifyRateLimitError,
} from "./errors.js";
import { uploadScreenshot } from "../cloud/uploadPrint.js";
import { browserPool } from "./browserPool.js";
import { makeLogger } from "../logger.js";

const log = makeLogger("spotify-session");
const HOME_URL = `${config.SPOTIFY_S4A_BASE.replace(/\/+$/, "")}/c/`;

// Sinais positivos de sessão válida (qualquer 1 basta).
const LOGGED_IN_SIGNALS = [
  SELECTORS.loggedInIndicator,
  '[data-testid="user-widget"]',
  '[data-testid="topbar-profile-button"]',
  'button[aria-label*="Account" i]',
  'button[aria-label*="Conta" i]',
  'a[href*="/roster"]',
  'nav[aria-label*="primary" i]',
];

// Sinais negativos (logout / login wall).
const LOGGED_OUT_SIGNALS = [
  SELECTORS.loginPageMarker,
  'form[action*="/login"]',
  'input[name="username"]',
  'button[data-testid="login-button"]',
  'a[href*="accounts.spotify.com/login"]',
];

async function anyVisible(page, selectors, timeout = 0) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (timeout > 0) {
        await loc.waitFor({ state: "attached", timeout }).catch(() => {});
      }
      if ((await loc.count()) > 0) return sel;
    } catch {}
  }
  return null;
}

async function urlLooksLikeLogin(page) {
  const u = page.url() || "";
  return /accounts\.spotify\.com\/.*login|\/login(\?|$)/i.test(u);
}

/** Captura print da página atual e envia para bucket (best-effort). */
async function dumpAuthFail(page, reason) {
  try {
    const buf = await browserPool.captureDebug(page, reason);
    if (!buf) return null;
    const path = `auth-fails/${new Date().toISOString().replace(/[:.]/g, "-")}-${reason}.png`;
    const up = await uploadScreenshot(buf, path);
    log.warn("auth fail screenshot salvo", { reason, url: page.url(), signed_url: up?.signed_url });
    return up?.signed_url || null;
  } catch (e) {
    log.warn("dumpAuthFail falhou", { error: String(e?.message || e) });
    return null;
  }
}

/**
 * Garante sessão válida. Lança erro tipado se não.
 * Detecção multi-sinal + screenshot de debug em falha.
 */
export async function assertLoggedIn(page) {
  if (!page.url() || page.url() === "about:blank") {
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  }

  // Detecta redirect imediato p/ accounts.spotify.com/login
  if (await urlLooksLikeLogin(page)) {
    const screenshot = await dumpAuthFail(page, "redirect-login");
    throw new SpotifyAuthError(
      `Redirect para login detectado: ${page.url()}${screenshot ? ` — debug: ${screenshot}` : ""}`
    );
  }

  // Captcha tem prioridade.
  const captcha = await page.locator(SELECTORS.captchaMarker).first().count().catch(() => 0);
  if (captcha > 0) {
    await dumpAuthFail(page, "captcha");
    throw new SpotifyCaptchaError();
  }

  const rate = await page.locator(SELECTORS.rateLimitMarker).first().count().catch(() => 0);
  if (rate > 0) {
    await dumpAuthFail(page, "rate-limit");
    throw new SpotifyRateLimitError();
  }

  // Espera rede assentar um pouco (S4A é SPA).
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

  // Re-checa URL pós networkidle (pode ter redirecionado depois)
  if (await urlLooksLikeLogin(page)) {
    const screenshot = await dumpAuthFail(page, "redirect-login-late");
    throw new SpotifyAuthError(
      `Redirect tardio para login: ${page.url()}${screenshot ? ` — debug: ${screenshot}` : ""}`
    );
  }

  // Sinal positivo (qualquer 1)
  const positive = await anyVisible(page, LOGGED_IN_SIGNALS, 6000);
  if (positive) {
    log.debug?.("login OK", { signal: positive, url: page.url() });
    return;
  }

  // Sinal negativo OU URL de login → auth error.
  const negative = await anyVisible(page, LOGGED_OUT_SIGNALS, 0);
  const onLoginUrl = await urlLooksLikeLogin(page);

  const reason = negative ? "logged-out-marker" : onLoginUrl ? "login-url" : "no-positive-signal";
  const screenshot = await dumpAuthFail(page, reason);
  throw new SpotifyAuthError(
    `Indicador de login ausente (${reason}) em ${page.url()}${screenshot ? ` — debug: ${screenshot}` : ""}`
  );
}

  // Sinal negativo OU URL de login → auth error.
  const negative = await anyVisible(page, LOGGED_OUT_SIGNALS, 0);
  const onLoginUrl = await urlLooksLikeLogin(page);

  const reason = negative ? "logged-out-marker" : onLoginUrl ? "login-url" : "no-positive-signal";
  const screenshot = await dumpAuthFail(page, reason);
  throw new SpotifyAuthError(
    `Indicador de login ausente (${reason}) em ${page.url()}${screenshot ? ` — debug: ${screenshot}` : ""}`
  );
}

/**
 * Pré-flight: valida cookies sp_dc/sp_key no storageState antes de iniciar jobs.
 * Não navega — só inspeciona o storageState carregado no contexto.
 */
export async function quickSessionPrecheck(context) {
  try {
    const cookies = await context.cookies("https://artists.spotify.com");
    const required = ["sp_dc", "sp_t", "sp_key"];
    const present = required.filter((n) => cookies.some((c) => c.name === n));
    if (present.length === 0) {
      log.warn("precheck: nenhum cookie de sessão Spotify encontrado");
      return false;
    }
    log.info("precheck: cookies presentes", { present });
    return true;
  } catch {
    return false;
  }
}
