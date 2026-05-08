// Logger leve com níveis. PM2 captura stdout/stderr automaticamente.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? 20;

function fmt(level, scope, msg, extra) {
  const ts = new Date().toISOString();
  const base = `${ts} [${level.toUpperCase()}] [${scope}] ${msg}`;
  if (extra && Object.keys(extra).length) {
    try { return `${base} ${JSON.stringify(extra)}`; } catch { return base; }
  }
  return base;
}

export function makeLogger(scope) {
  return {
    debug: (m, e) => { if (LEVELS.debug >= MIN) console.log(fmt("debug", scope, m, e)); },
    info:  (m, e) => { if (LEVELS.info  >= MIN) console.log(fmt("info",  scope, m, e)); },
    warn:  (m, e) => { if (LEVELS.warn  >= MIN) console.warn(fmt("warn", scope, m, e)); },
    error: (m, e) => { if (LEVELS.error >= MIN) console.error(fmt("error", scope, m, e)); },
  };
}
