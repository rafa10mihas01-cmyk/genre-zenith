# Contrato do Agente VPS — AI Ops Center

Pequeno serviço Node que roda na sua VPS, conecta no Lovable Cloud, executa comandos
(PM2, shell whitelisted) e envia métricas reais (CPU/RAM/Disco/PM2/uptime) para o painel `/sistema`.

## Endpoints (edge functions)

Base: `https://xtxxjmkijeyxkdyxtvsf.functions.supabase.co`

Auth: header `x-agent-token: <OPS_AGENT_TOKEN>` (secret configurado no Lovable Cloud).

### 1. `GET /ops-agent-poll?agent_id=default&limit=1`
Retorna próximos comandos enfileirados. `204` se nada.
```json
{ "commands": [{ "id": "uuid", "kind": "pm2|shell|system_metrics|restart_bot|custom",
                 "command": "pm2 jlist", "args": {}, "timeout_ms": 30000 }] }
```

### 2. `POST /ops-agent-report`
Reporta resultado OU envia métricas.

**Resultado de comando:**
```json
{ "type": "command_update", "command_id": "uuid",
  "status": "running|success|error|timeout",
  "stdout": "...", "stderr": "...", "exit_code": 0,
  "started_at": "2026-...", "finished_at": "2026-...", "duration_ms": 1234 }
```

**Heartbeat com métricas (envie a cada 30–60s):**
```json
{ "type": "metrics", "agent_id": "default", "hostname": "vps-01",
  "agent_version": "1.0.0",
  "metrics": {
    "cpu_percent": 12.4, "mem_percent": 48.1,
    "mem_used_mb": 3850, "mem_total_mb": 8000,
    "swap_percent": 2.1,
    "disk_percent": 35.0, "disk_used_gb": 35, "disk_total_gb": 100,
    "uptime_seconds": 864000,
    "load_avg": [0.4, 0.5, 0.6],
    "pm2_processes": [
      { "name": "spotify-bot", "status": "online", "cpu": 5, "memory": 180000000, "restarts": 2 }
    ],
    "chrome_instances": 3
  } }
```

## Loop sugerido (Node)
```js
import os from "node:os";
import { execSync } from "node:child_process";

const BASE = process.env.OPS_BASE; // https://...functions.supabase.co
const TOKEN = process.env.OPS_AGENT_TOKEN;
const headers = { "x-agent-token": TOKEN, "content-type": "application/json" };

async function poll() {
  const r = await fetch(`${BASE}/ops-agent-poll?agent_id=default`, { headers });
  if (r.status === 204) return;
  const { commands } = await r.json();
  for (const c of commands) await runAndReport(c);
}

async function runAndReport(cmd) {
  const t0 = Date.now();
  try {
    const out = execSync(cmd.command, { timeout: cmd.timeout_ms ?? 30000, encoding: "utf8" });
    await report({ type: "command_update", command_id: cmd.id, status: "success",
      stdout: out, exit_code: 0, finished_at: new Date().toISOString(),
      duration_ms: Date.now() - t0 });
  } catch (e) {
    await report({ type: "command_update", command_id: cmd.id, status: "error",
      stderr: String(e.stderr || e.message), exit_code: e.status ?? 1,
      finished_at: new Date().toISOString(), duration_ms: Date.now() - t0 });
  }
}

async function sendMetrics() {
  // colete CPU/RAM/Disco/PM2 e POST em /ops-agent-report
}

const report = (body) => fetch(`${BASE}/ops-agent-report`, { method: "POST", headers, body: JSON.stringify(body) });

setInterval(poll, 3000);
setInterval(sendMetrics, 30000);
```

## Segurança
- `shell_exec` deve ter whitelist no agente (não execute qualquer string vinda do Cloud).
- Rode o agente como usuário não-root sempre que possível.
- Rotacione o `OPS_AGENT_TOKEN` periodicamente.
