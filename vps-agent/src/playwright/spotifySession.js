// Validação de sessão Spotify for Artists.
import { config } from "../config.js";
import { SELECTORS } from "./spotifySelectors.js";
import {
  SpotifyAuthError, SpotifyCaptchaError, SpotifyRateLimitError,
} from "./errors.js";

const HOME_URL = `${config.SPOTIFY_S4A_BASE.replace(/\/+$/, "")}/c/`;

/**
 * Garante que estamos logados. Lança erro tipado se não.
 * Pode ser chamada dentro de qualquer page já aberta.
 */
export async function assertLoggedIn(page) {
  // Se a page atual ainda não navegou, vamos para a home.
  if (!page.url() || page.url() === "about:blank") {
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  }

  // Captcha tem prioridade — bloqueia tudo.
  const captcha = await page.locator(SELECTORS.captchaMarker).first().count().catch(() => 0);
  if (captcha > 0) throw new SpotifyCaptchaError();

  const rate = await page.locator(SELECTORS.rateLimitMarker).first().count().catch(() => 0);
  if (rate > 0) throw new SpotifyRateLimitError();

  const login = await page.locator(SELECTORS.loginPageMarker).first().count().catch(() => 0);
  if (login > 0) throw new SpotifyAuthError();

  // Verifica indicador positivo com timeout curto.
  try {
    await page.locator(SELECTORS.loggedInIndicator).first().waitFor({ state: "attached", timeout: 8000 });
  } catch {
    // pode ter caído na home pública ou em /login
    const url = page.url();
    if (/\/login/.test(url)) throw new SpotifyAuthError();
    throw new SpotifyAuthError(`Indicador de login ausente em ${url}`);
  }
}
