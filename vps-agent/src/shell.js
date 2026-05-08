import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const pexec = promisify(execFile);

function isShellSafe(cmd) {
  if (!cmd || typeof cmd !== "string") return false;
  return config.SHELL_WHITELIST.some((rx) => rx.test(cmd));
}

// Executor central — usado por shell, pm2, docker e healthcheck.
// Sempre retorna { ok, stdout, stderr, exit_code, duration_ms, started_at, finished_at }.
export async function runCommand(cmdString, { timeout_ms } = {}) {
  const started_at = new Date().toISOString();
  const t0 = Date.now();
  const timeout = Math.min(Math.max(Number(timeout_ms) || config.SHELL_TIMEOUT_MS, 1000), 5 * 60 * 1000);

  // Quebra simples em programa + args (sem shell para evitar injection).
  // Aceita aspas duplas como agrupador.
  const parts = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(cmdString)) !== null) parts.push(m[1] ?? m[2]);
  if (parts.length === 0) {
    return { ok: false, stdout: "", stderr: "comando vazio", exit_code: 2, duration_ms: 0, started_at, finished_at: started_at };
  }
  const [bin, ...args] = parts;

  try {
    const { stdout, stderr } = await pexec(bin, args, { timeout, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" });
    const finished_at = new Date().toISOString();
    return { ok: true, stdout, stderr, exit_code: 0, duration_ms: Date.now() - t0, started_at, finished_at };
  } catch (e) {
    const finished_at = new Date().toISOString();
    const isTimeout = e?.killed && e?.signal === "SIGTERM";
    return {
      ok: false,
      stdout: e?.stdout?.toString?.() ?? "",
      stderr: (e?.stderr?.toString?.() ?? "") || String(e?.message || e),
      exit_code: e?.code ?? (isTimeout ? 124 : 1),
      duration_ms: Date.now() - t0,
      started_at,
      finished_at,
      timeout: isTimeout,
    };
  }
}

export async function runShellWhitelisted(cmdString, opts) {
  if (!isShellSafe(cmdString)) {
    const ts = new Date().toISOString();
    return { ok: false, stdout: "", stderr: `Comando não permitido pela whitelist: ${cmdString}`, exit_code: 126, duration_ms: 0, started_at: ts, finished_at: ts };
  }
  return runCommand(cmdString, opts);
}

export { isShellSafe };
