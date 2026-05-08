import "dotenv/config";

function req(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`[config] FATAL: env ${name} ausente`);
    process.exit(1);
  }
  return v.trim();
}

function num(name, def) {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function bool(name, def) {
  const v = process.env[name];
  if (v == null) return def;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

const whitelistRaw = process.env.SHELL_WHITELIST ?? "";
const SHELL_WHITELIST = whitelistRaw
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => {
    try { return new RegExp(p); }
    catch { console.warn(`[config] regex inválida ignorada: ${p}`); return null; }
  })
  .filter(Boolean);

export const config = {
  OPS_BASE: req("OPS_BASE").replace(/\/+$/, ""),
  OPS_AGENT_TOKEN: req("OPS_AGENT_TOKEN"),
  AGENT_ID: process.env.AGENT_ID?.trim() || "default",
  BOT_NAME: process.env.BOT_NAME?.trim() || "vps-agent",
  AGENT_VERSION: "1.0.0",

  POLL_INTERVAL_MS: num("POLL_INTERVAL_MS", 3000),
  METRICS_INTERVAL_MS: num("METRICS_INTERVAL_MS", 30000),
  HEALTHCHECK_INTERVAL_MS: num("HEALTHCHECK_INTERVAL_MS", 60000),

  SPOTIFY_BOT_PM2_NAME: process.env.SPOTIFY_BOT_PM2_NAME?.trim() || "spotify-bot",
  SPOTIFY_BOT_STALE_AFTER_S: num("SPOTIFY_BOT_STALE_AFTER_S", 600),
  WATCHDOG_MAX_RESTARTS_PER_HOUR: num("WATCHDOG_MAX_RESTARTS_PER_HOUR", 4),

  DOCKER_ENABLED: bool("DOCKER_ENABLED", true),

  SHELL_WHITELIST,
  SHELL_TIMEOUT_MS: num("SHELL_TIMEOUT_MS", 15000),

  // ===== Worker / Playwright =====
  SUPABASE_URL: process.env.SUPABASE_URL?.trim() || "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "",

  SPOTIFY_S4A_BASE: process.env.SPOTIFY_S4A_BASE?.trim() || "https://artists.spotify.com",
  SPOTIFY_STORAGE_STATE_PATH: process.env.SPOTIFY_STORAGE_STATE_PATH?.trim() || "",
  PLAYWRIGHT_HEADLESS: bool("PLAYWRIGHT_HEADLESS", true),
  PLAYWRIGHT_NAV_TIMEOUT_MS: num("PLAYWRIGHT_NAV_TIMEOUT_MS", 45000),
  PLAYWRIGHT_ACTION_TIMEOUT_MS: num("PLAYWRIGHT_ACTION_TIMEOUT_MS", 15000),

  BROWSER_RECYCLE_AFTER_JOBS: num("BROWSER_RECYCLE_AFTER_JOBS", 50),
  BROWSER_RECYCLE_AFTER_MIN: num("BROWSER_RECYCLE_AFTER_MIN", 60),
  BROWSER_STUCK_AFTER_MS: num("BROWSER_STUCK_AFTER_MS", 300000),

  JOB_TIMEOUT_MS: num("JOB_TIMEOUT_MS", 180000),
  WORKER_MEMORY_LIMIT_MB: num("WORKER_MEMORY_LIMIT_MB", 800),
};
