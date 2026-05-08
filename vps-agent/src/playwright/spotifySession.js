// Validação de sessão Spotify for Artists — detector RESILIENTE e TOLERANTE.
//
// Filosofia: se conseguimos navegar até uma URL autenticada do S4A sem ser
// redirecionados para accounts.spotify.com/login, a sessão é considerada VÁLIDA.
// Só abortamos com SpotifyAuthError em sinais inequívocos:
//   - URL final é página de login
//   - Marker explícito de logout (form de login, botão "Log in") visível
//   - Nenhum dos múltiplos sinais de UI autenticada presentes APÓS retries
//
// Fluxo:
//   1. Aguarda DOM + networkidle (best-effort).
//   2. Fecha popups de consent/cookie/onboarding/modal.
//   3. Checa URL — se for /login, aborta.
//   4. Coleta sinais positivos (qualquer 1 basta) e negativos.
//   5. Retry até 3x com backoff curto antes de desistir.
//   6. Em falha: screenshot + log detalhado (URL, title, seletores ✓/✗).
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

// ---------- Sinais ----------
// Qualquer 1 destes = sessão autenticada.
const LOGGED_IN_SIGNALS = [
  SELECTORS.loggedInIndicator,
  '[data-testid="user-widget"]',
  '[data-testid="topbar-profile-button"]',
  '[data-testid="profile-menu-button"]',
  '[data-testid="user-menu"]',
  '[data-testid="header-user-menu"]',
  'button[aria-label*="Account" i]',
  'button[aria-label*="Conta" i]',
  'button[aria-label*="profile" i]',
  'button[aria-label*="perfil" i]',
  'a[href*="/roster"]',
  'a[href*="/c/"]',
  'a[href*="/song/"]',
  'a[href*="/artist/"]',
  'nav[aria-label*="primary" i]',
  'nav[aria-label*="main" i]',
  'aside nav',
  '[data-testid="sidebar"]',
  '[data-testid="nav-sidebar"]',
  'header img[alt*="avatar" i]',
  'header img[src*="profile"]',
  // Layouts mais antigos
  '#main-nav', '#sidebar', '.user-menu', '.profile-menu',
];

// Sinais inequívocos de NÃO autenticado.
const LOGGED_OUT_SIGNALS = [
  SELECTORS.loginPageMarker,
  'form[action*="/login"]',
  'input[name="username"][type="text"], input[id="login-username"]',
  'input[type="password"][name="password"]',
  'button[data-testid="login-button"]',
  'a[data-testid="login-link"]',
];

// Popups que devem ser fechados antes de validar.
const DISMISS_BUTTONS = [
  '#onetrust-accept-btn-handler',
  'button#onetrust-accept-btn-handler',
  'button[aria-label*="Accept" i][aria-label*="cookies" i]',
  'button[aria-label*="Aceitar" i]',
  'button[data-testid="cookie-banner-accept"]',
  'button:has-text("Accept all")',
  'button:has-text("Aceitar todos")',
  'button:has-text("Aceitar")',
  'button:has-text("Got it")',
  'button:has-text("Entendi")',
  'button:has-text("Continue")',
  'button:has-text("Continuar")',
  'button[aria-label="Close" i]',
  'button[aria-label="Fechar" i]',
  'button[data-testid="modal-close"]',
  '[role="dialog"] button[aria-label*="close" i]',
];

// ---------- Helpers ----------
function urlLooksLikeLogin(page) {
  const u = page.url() || "";
  return /accounts\.spotify\.com\/.*login|\/login(\?|$|\/)/i.test(u);
}

function urlLooksAuthenticated(page) {
  const u = page.url() || "";
  // S4A usa /c/, /song/<id>, /artist/<id>, /roster — todos exigem login.
  return /artists\.spotify\.com\/(c|song|artist|roster|home|music|audience)/i.test(u);
}

async function dismissPopups(page) {
  const closed = [];
  for (const sel of DISMISS_BUTTONS) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && await loc.isVisible().catch(() => false)) {
        await loc.click({ timeout: 1500 }).catch(() => {});
        closed.push(sel);
        await page.waitForTimeout(300);
      }
    } catch {}
  }
  if (closed.length) log.info("popups fechados", { count: closed.length, sample: closed.slice(0, 3) });
  return closed;
}

async function findFirstVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0) return sel;
    } catch {}
  }
  return null;
}

async function dumpAuthFail(page, reason, extra = {}) {
  try {
    const buf = await browserPool.captureDebug(page, reason);
    if (!buf) return null;
    const path = `auth-fails/${new Date().toISOString().replace(/[:.]/g, "-")}-${reason}.png`;
    const up = await uploadScreenshot(buf, path);
    log.warn("auth fail screenshot salvo", { reason, url: page.url(), signed_url: up?.signed_url, ...extra });
    return up?.signed_url || null;
  } catch (e) {
    log.warn("dumpAuthFail falhou", { error: String(e?.message || e) });
    return null;
  }
}

// ---------- API pública ----------

/**
 * Garante sessão válida. Tolerante: aceita qualquer sinal forte de UI autenticada
 * OU URL claramente autenticada sem redirect para login.
 */
export async function assertLoggedIn(page) {
  // Modo legacy: comportamento original pré-refactor (1 seletor, 8s wait, sem pop-up).
  if (config.PLAYWRIGHT_LEGACY_MODE) {
    if (!page.url() || page.url() === "about:blank") {
      await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
    }
    if (await page.locator(SELECTORS.captchaMarker).first().count().catch(() => 0)) throw new SpotifyCaptchaError();
    if (await page.locator(SELECTORS.rateLimitMarker).first().count().catch(() => 0)) throw new SpotifyRateLimitError();
    if (await page.locator(SELECTORS.loginPageMarker).first().count().catch(() => 0)) throw new SpotifyAuthError();
    try {
      await page.locator(SELECTORS.loggedInIndicator).first().waitFor({ state: "attached", timeout: 8000 });
      log.info("login OK (legacy)", { url: page.url() });
      return;
    } catch {
      const url = page.url();
      if (/\/login/.test(url)) throw new SpotifyAuthError();
      throw new SpotifyAuthError(`Indicador de login ausente em ${url}`);
    }
  }

  // === Detector novo (resiliente) ===

  if (!page.url() || page.url() === "about:blank") {
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  }

  // Aguarda render inicial.
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});

  // Captcha tem prioridade absoluta.
  if (await page.locator(SELECTORS.captchaMarker).first().count().catch(() => 0)) {
    await dumpAuthFail(page, "captcha");
    throw new SpotifyCaptchaError();
  }
  if (await page.locator(SELECTORS.rateLimitMarker).first().count().catch(() => 0)) {
    await dumpAuthFail(page, "rate-limit");
    throw new SpotifyRateLimitError();
  }

  // Fecha popups que podem estar tampando os sinais.
  await dismissPopups(page);

  // Loop tolerante: até 3 tentativas com backoff curto.
  const MAX_TRIES = 3;
  let lastReason = "no-positive-signal";
  let lastTitle = "";
  let lastUrl = "";
  let lastPositive = null;
  let lastNegative = null;

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    lastUrl = page.url();
    lastTitle = await page.title().catch(() => "");

    // Redirect óbvio para login.
    if (urlLooksLikeLogin(page)) {
      lastReason = "redirect-login";
      break;
    }

    // Sinal positivo de UI?
    lastPositive = await findFirstVisible(page, LOGGED_IN_SIGNALS);
    if (lastPositive) {
      log.info("login OK (sinal de UI)", { signal: lastPositive, url: lastUrl, title: lastTitle, attempt });
      return;
    }

    // Sem sinal de UI mas URL é claramente autenticada e não há marker de logout?
    // Aceita como válido (fallback inteligente).
    lastNegative = await findFirstVisible(page, LOGGED_OUT_SIGNALS);
    if (!lastNegative && urlLooksAuthenticated(page)) {
      log.info("login OK (URL autenticada sem markers de logout)", { url: lastUrl, title: lastTitle, attempt });
      return;
    }

    if (lastNegative) {
      lastReason = "logged-out-marker";
      break;
    }

    log.warn("sem sinal positivo, retry", { attempt, url: lastUrl, title: lastTitle });
    await page.waitForTimeout(1500 * attempt);
    await dismissPopups(page).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  }

  // Falhou. Dump detalhado.
  const screenshot = await dumpAuthFail(page, lastReason, {
    title: lastTitle,
    positive_signal: lastPositive,
    negative_signal: lastNegative,
  });
  log.error("login detector falhou", {
    reason: lastReason,
    url: lastUrl,
    title: lastTitle,
    positive_signal: lastPositive,
    negative_signal: lastNegative,
    screenshot,
  });
  throw new SpotifyAuthError(
    `Indicador de login ausente (${lastReason}) em ${lastUrl} — title="${lastTitle}"${
      screenshot ? ` — debug: ${screenshot}` : ""
    }`
  );
}

/**
 * Pré-flight: valida cookies sp_dc/sp_t/sp_key no contexto antes de iniciar jobs.
 * Não bloqueia — só sinaliza warning.
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
