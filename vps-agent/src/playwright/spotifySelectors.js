/**
 * SELETORES REAIS DO SPOTIFY FOR ARTISTS.
 *
 * Estes valores são MAINTAINED AQUI (centralizado) — quando o Spotify muda o HTML,
 * só este arquivo precisa ser atualizado. NÃO espalhe seletores nos handlers.
 *
 * Como descobrir cada um:
 *   1. Abra https://artists.spotify.com logado.
 *   2. Inspecione o elemento (DevTools → Elements).
 *   3. Pegue o seletor mais ESTÁVEL possível (testid > aria-label > classe semântica).
 *      EVITE classes geradas (`css-1a2b3c4`) — elas mudam a cada deploy.
 *
 * Substitua TODO `__TODO__` por valor real antes de operar em produção.
 * Os handlers usam `assertSelector()` para falhar cedo com SpotifySelectorError.
 */
export const SELECTORS = {
  // Detecta que estamos logados (qualquer elemento que SÓ aparece em sessão válida).
  // Ex: avatar do usuário no header, link "Roster", etc.
  loggedInIndicator: process.env.SEL_LOGGED_IN ?? '[data-testid="user-widget"]',

  // Página de login → se aparecer, sessão expirou.
  loginPageMarker: process.env.SEL_LOGIN_MARKER ?? 'form[action*="/login"]',

  // Captcha / challenge da Spotify.
  captchaMarker: process.env.SEL_CAPTCHA ?? '[data-testid="captcha-challenge"], #px-captcha',

  // Banner de rate limit.
  rateLimitMarker: process.env.SEL_RATELIMIT ?? '[data-testid="rate-limited"]',

  // Métrica de streams totais na página de música.
  // Geralmente um <span data-testid="stat-total-streams"> ou similar.
  songTotalStreams: process.env.SEL_SONG_TOTAL_STREAMS ?? '[data-testid="stat-total-streams"]',
  songStreams24h:   process.env.SEL_SONG_STREAMS_24H   ?? '[data-testid="stat-streams-24h"]',
  songStreams7d:    process.env.SEL_SONG_STREAMS_7D    ?? '[data-testid="stat-streams-7d"]',
  songStreams28d:   process.env.SEL_SONG_STREAMS_28D   ?? '[data-testid="stat-streams-28d"]',

  // Container do "print" final (área que vira screenshot recortada).
  // Se vazio, screenshot do viewport inteiro.
  printArea: process.env.SEL_PRINT_AREA ?? 'main[role="main"]',
};

export function isPlaceholder(value) {
  return typeof value === "string" && value.startsWith("__TODO__");
}
