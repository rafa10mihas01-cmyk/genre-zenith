import { runCommand, runShellWhitelisted } from "./shell.js";
import { config } from "./config.js";

// Wrappers programáticos: NÃO passam pela whitelist do usuário, mas só aceitam
// argumentos previamente validados (nome de processo / container).
// Validação de identificador: alfanumérico, hífen, underline, ponto, dois-pontos, slash.
const SAFE_ID = /^[A-Za-z0-9._:\-\/]+$/;

function safeId(s) {
  if (typeof s !== "string" || !SAFE_ID.test(s)) {
    throw new Error(`identificador inválido: ${s}`);
  }
  return s;
}

// ===== PM2 =====
export const pm2 = {
  list: () => runCommand("pm2 jlist", { timeout_ms: 8000 }),
  restart: (name) => runCommand(`pm2 restart ${safeId(name)}`, { timeout_ms: 60000 }),
  stop:    (name) => runCommand(`pm2 stop ${safeId(name)}`, { timeout_ms: 30000 }),
  start:   (name) => runCommand(`pm2 start ${safeId(name)}`, { timeout_ms: 60000 }),
  reload:  (name) => runCommand(`pm2 reload ${safeId(name)}`, { timeout_ms: 60000 }),
  logs:    (name, lines = 200) => runCommand(`pm2 logs ${safeId(name)} --lines ${Number(lines) || 200} --nostream`, { timeout_ms: 10000 }),
  describe:(name) => runCommand(`pm2 describe ${safeId(name)}`, { timeout_ms: 8000 }),
  flush:   (name) => runCommand(`pm2 flush ${safeId(name)}`, { timeout_ms: 8000 }),
};

// ===== Docker =====
export const docker = {
  ps: () => runCommand("docker ps --format {{json .}}", { timeout_ms: 8000 }),
  restart: (name) => runCommand(`docker restart ${safeId(name)}`, { timeout_ms: 60000 }),
  stop:    (name) => runCommand(`docker stop ${safeId(name)}`, { timeout_ms: 60000 }),
  start:   (name) => runCommand(`docker start ${safeId(name)}`, { timeout_ms: 60000 }),
  logs:    (name, lines = 200) => runCommand(`docker logs --tail ${Number(lines) || 200} ${safeId(name)}`, { timeout_ms: 15000 }),
};

// ===== Shell (whitelist do usuário) =====
export const shell = {
  exec: (cmd, opts) => runShellWhitelisted(cmd, opts),
};

// ===== Despachante principal: recebe um comando vindo do Cloud =====
// Schema esperado: { id, kind, command, args, timeout_ms }
//   kind: pm2 | docker | shell | restart_bot | system_metrics | custom
export async function executeCommand(cmd, ctx) {
  const t = cmd.timeout_ms ?? undefined;
  const args = cmd.args || {};
  switch (cmd.kind) {
    case "pm2": {
      const m = /^pm2\s+(\w+)(?:\s+(.+))?$/.exec(cmd.command || "");
      if (!m) return runCommand(cmd.command || "pm2 jlist", { timeout_ms: t });
      const sub = m[1].toLowerCase();
      const target = (m[2] || "").trim();
      if (sub === "jlist") return pm2.list();
      if (!target && ["restart","stop","start","reload","logs","describe","flush"].includes(sub)) {
        return { ok: false, stderr: `pm2 ${sub} requer nome`, exit_code: 2, stdout: "", duration_ms: 0, started_at: new Date().toISOString(), finished_at: new Date().toISOString() };
      }
      switch (sub) {
        case "restart": return pm2.restart(target);
        case "stop":    return pm2.stop(target);
        case "start":   return pm2.start(target);
        case "reload":  return pm2.reload(target);
        case "logs":    return pm2.logs(target, args.lines ?? 200);
        case "describe":return pm2.describe(target);
        case "flush":   return pm2.flush(target);
        default:        return runCommand(cmd.command, { timeout_ms: t });
      }
    }
    case "docker": {
      if (!config.DOCKER_ENABLED) {
        const ts = new Date().toISOString();
        return { ok: false, stdout: "", stderr: "Docker desabilitado neste agente", exit_code: 126, duration_ms: 0, started_at: ts, finished_at: ts };
      }
      return runCommand(cmd.command, { timeout_ms: t });
    }
    case "restart_bot": {
      const target = args.process || config.SPOTIFY_BOT_PM2_NAME;
      ctx?.watchdog?.markManualRestart?.(target);
      return pm2.restart(target);
    }
    case "system_metrics":
      return { ok: true, stdout: JSON.stringify(await ctx.collectMetrics()), stderr: "", exit_code: 0, duration_ms: 0, started_at: new Date().toISOString(), finished_at: new Date().toISOString() };
    case "shell":
      return shell.exec(cmd.command, { timeout_ms: t });
    case "custom":
    default:
      return shell.exec(cmd.command, { timeout_ms: t });
  }
}
