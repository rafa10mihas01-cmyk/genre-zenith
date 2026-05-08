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
};
