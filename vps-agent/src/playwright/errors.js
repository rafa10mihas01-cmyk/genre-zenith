// Erros tipados do pipeline Spotify. `fatal=true` força dead-letter no worker.
export class SpotifyAuthError extends Error {
  constructor(msg = "Sessão Spotify inválida (login expirado)") {
    super(msg); this.name = "SpotifyAuthError"; this.fatal = true; this.kind = "spotify_login_invalid";
  }
}
export class SpotifyCaptchaError extends Error {
  constructor(msg = "Spotify exigiu captcha/challenge") {
    super(msg); this.name = "SpotifyCaptchaError"; this.fatal = true; this.kind = "spotify_captcha";
  }
}
export class SpotifyRateLimitError extends Error {
  constructor(msg = "Spotify retornou rate limit") {
    super(msg); this.name = "SpotifyRateLimitError"; this.fatal = false; this.kind = "spotify_rate_limit";
  }
}
export class SpotifySelectorError extends Error {
  constructor(selector, msg) {
    super(msg ?? `Seletor não encontrado: ${selector}`);
    this.name = "SpotifySelectorError"; this.selector = selector; this.fatal = false; this.kind = "spotify_selector_missing";
  }
}
export class JobTimeoutError extends Error {
  constructor(ms) { super(`Job excedeu timeout de ${ms}ms`); this.name = "JobTimeoutError"; this.fatal = false; this.kind = "job_timeout"; }
}
