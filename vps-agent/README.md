# NexEngine Ops Agent (VPS)

Agente Node oficial que roda na sua VPS, conecta no painel **/sistema** (Lovable Cloud) e fornece:

- ✅ Execução de comandos PM2 (`restart`, `stop`, `start`, `logs`, `describe`)
- ✅ Execução de comandos Docker (`ps`, `restart`, `stop`, `logs`)
- ✅ Shell controlado via **whitelist regex**
- ✅ Coleta automática de métricas reais (CPU, RAM, swap, disco, uptime, load avg)
- ✅ Inventário de processos PM2 + containers Docker + instâncias Chrome
- ✅ Healthcheck do `spotify-bot` com **watchdog** + restart automático
- ✅ Retry automático com backoff em todas as chamadas ao Cloud
- ✅ Logs estruturados via PM2
- ✅ Incident tracking com anti-flood (5min/tipo) e pausa por crashloop
- ✅ Limite configurável de restarts/hora antes de abrir incidente crítico
- ✅ **Workers de fila** (queue/worker) — N processos consumindo `jobs_queue` com retries, heartbeat e claim atômico (substitui execução monolítica do `spotify-artists-bot`)

Arquitetura desacoplada: **painel** (web) ↔ **edge functions** (Lovable Cloud) ↔ **agente VPS** ↔ **bots** (PM2/Docker). O agente é o único componente que toca o SO da VPS.

---

## 1. Instalação

```bash
# Pré-requisitos: Node ≥18.17, PM2 global, (opcional) Docker
sudo npm i -g pm2
cd /opt && git clone <seu-repo> nexengine && cd nexengine/vps-agent
npm install
cp .env.example .env
nano .env   # cole o OPS_AGENT_TOKEN (mesmo valor configurado no painel)
mkdir -p logs
```

## 2. Subir com PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # gera o comando de auto-start no boot da VPS
```

Logs em tempo real:
```bash
pm2 logs nexengine-ops-agent
```

## 3. Variáveis essenciais (`.env`)

| Variável | Padrão | O que faz |
|---|---|---|
| `OPS_AGENT_TOKEN` | — | Token compartilhado com o Cloud (obrigatório) |
| `OPS_BASE` | `https://xtxxjmkijeyxkdyxtvsf.functions.supabase.co` | Base das edge functions |
| `AGENT_ID` | `default` | Identidade desta VPS — único por máquina |
| `BOT_NAME` | `vps-agent` | Aparece nos heartbeats no painel |
| `SPOTIFY_BOT_PM2_NAME` | `spotify-bot` | Nome do processo PM2 do bot principal |
| `WATCHDOG_MAX_RESTARTS_PER_HOUR` | `4` | Limite antes do watchdog se pausar e abrir incidente |
| `DOCKER_ENABLED` | `true` | Habilita coleta + execução Docker |
| `SHELL_WHITELIST` | (ver `.env.example`) | Regex separadas por vírgula que filtram `shell_exec` |

## 4. Whitelist de shell

Toda chamada `shell_exec` vinda do painel é matched contra `SHELL_WHITELIST`. Se nenhuma regex casar, retorna `exit_code 126`. Comandos PM2 e Docker disparados pelos botões do painel **não passam pela whitelist** — usam wrappers programáticos com validação de identificador (`^[A-Za-z0-9._:\-/]+$`).

Padrão seguro:
```
^pm2 ,^docker ps,^docker logs ,^df -h,^free -h,^uptime$,^uname -a$,^systemctl status ,^journalctl -u ,^ls /var/log
```

## 5. Healthcheck / Watchdog

A cada `HEALTHCHECK_INTERVAL_MS` (padrão 60s) o agente:

1. Lê `pm2 jlist` e localiza o processo `SPOTIFY_BOT_PM2_NAME`
2. Se **não existir** → incidente `bot_missing` (severity: high)
3. Se **status ≠ online** → incidente `bot_offline` + auto-restart
4. Se **memória > 1500MB** → incidente `bot_memory_high` + auto-restart
5. Se **>30 restarts e uptime <60s** → incidente `bot_crashloop` + **pausa o watchdog**
6. Se ultrapassar `WATCHDOG_MAX_RESTARTS_PER_HOUR` → incidente `watchdog_paused`

Anti-flood: máx 1 incidente do mesmo tipo a cada 5min.

## 6. Múltiplos bots / múltiplas VPS

Para rodar mais agentes (cada VPS tem o seu):
- mude `AGENT_ID` no `.env`
- comandos no painel são roteados pelo `agent_id`
- métricas aparecem separadas no `/sistema → Controle`

## 7. Atualização

```bash
cd /opt/nexengine && git pull
cd vps-agent && npm install --omit=dev
pm2 restart nexengine-ops-agent
```

## 8. Playwright / Sessão Spotify (handlers reais)

Os workers executam **coleta real** no Spotify for Artists via Playwright + sessão persistente.

**Setup único na VPS:**

```bash
cd /opt/nexengine/vps-agent
npm install                          # instala playwright
npx playwright install --with-deps chromium

# Gere a sessão logada uma vez (interativo, browser real)
node -e "(async () => {
  const { chromium } = require('playwright');
  const b = await chromium.launch({ headless: false });
  const c = await b.newContext();
  const p = await c.newPage();
  await p.goto('https://artists.spotify.com');
  console.log('Faça login manualmente e pressione ENTER aqui...');
  process.stdin.once('data', async () => {
    await c.storageState({ path: '/opt/nexengine/secrets/spotify-session.json' });
    await b.close(); process.exit(0);
  });
})();"
```

Depois aponte `SPOTIFY_STORAGE_STATE_PATH` no `.env` para esse arquivo. Quando a sessão expirar, o handler abre incidente `spotify_login_invalid` no painel — basta regerar o JSON.

**Seletores reais:** centralizados em `src/playwright/spotifySelectors.js`. Quando o Spotify muda o HTML, é o único lugar a tocar (ou via `SEL_*` no `.env` sem rebuild).

**Garantias do browser pool:**
- 1 Chromium persistente por worker (reutilizado entre jobs)
- reciclado após `BROWSER_RECYCLE_AFTER_JOBS` ou `BROWSER_RECYCLE_AFTER_MIN`
- `page.close()` no `finally` (sem leak)
- watchdog interno mata o pool se ficar > `BROWSER_STUCK_AFTER_MS` ocupado
- worker se auto-encerra (PM2 reinicia) se RSS > `WORKER_MEMORY_LIMIT_MB`

**Tipos de erro tratados:**
| Erro | fatal? | Comportamento |
|---|---|---|
| `SpotifyAuthError` | sim | dead-letter + incidente `spotify_login_invalid` |
| `SpotifyCaptchaError` | sim | dead-letter + incidente `spotify_captcha` |
| `SpotifyRateLimitError` | não | retry com backoff exponencial |
| `JobTimeoutError` (>`JOB_TIMEOUT_MS`) | não | retry |
| Selector ausente / parse falhou | não | retry (3x) → falha |

**Scheduler:** painel `/sistema → Fila` tem botão "Rodar agora" que invoca a edge `jobs-scheduler` e enfileira automaticamente coletas/refresh/print batches respeitando `dedupe_key` e cooldowns.

**Migração do bot monolítico:** rode os workers em paralelo ao bot antigo até estabilizar, depois `pm2 stop spotify-bot` na VPS. O `dedupe_key` impede coleta duplicada.

## 9. Múltiplos bots / múltiplas VPS

O `ecosystem.config.cjs` sobe `WORKER_COUNT` processos `nexengine-worker-N` em paralelo ao agente. Cada worker:

1. Faz `POST /jobs-claim` — reserva um job atomicamente (`FOR UPDATE SKIP LOCKED`).
2. Executa o handler registrado em `src/handlers/index.js` para o `job_type`.
3. Faz `POST /jobs-complete` (status `completed` ou `failed`).
4. Em paralelo: `POST /workers-heartbeat` a cada `WORKER_HEARTBEAT_MS` com CPU/RAM/jobs.

Falhas voltam para a fila com **backoff exponencial** até `max_attempts` do job. Lance `Error` com `err.fatal = true` no handler para forçar dead-letter imediato (sem retry).

**Adicionar um novo tipo de job:**

```js
// src/handlers/meuJob.js
export async function meuJob(job) {
  const { algo } = job.payload;
  if (!algo) { const e = new Error("payload.algo obrigatório"); e.fatal = true; throw e; }
  // ... lógica real
  return { ok: true };
}

// src/handlers/index.js
import { meuJob } from "./meuJob.js";
export const handlers = { ...handlers, "meu.job": meuJob };
```

Reinicie os workers: `pm2 restart /nexengine-worker-/`.

**Acompanhar:** painel `/sistema → Fila` (KPIs e jobs) e `/sistema → Workers` (heartbeats).

**Variáveis de worker** (`.env`):

| Variável | Padrão | O que faz |
|---|---|---|
| `WORKER_COUNT` | `2` | Quantos workers o ecosystem sobe |
| `WORKER_KIND` | `spotify-artists-worker` | Rótulo lógico (aparece no painel) |
| `WORKER_JOB_TYPES` | `spotify.artist.fetch,spotify.deal.collect` | Tipos que este worker aceita |
| `WORKER_LEASE_SECONDS` | `300` | Tempo de lease antes de requeue automático |
| `WORKER_IDLE_SLEEP_MS` | `2000` | Pausa quando fila vazia |
| `WORKER_HEARTBEAT_MS` | `15000` | Frequência de heartbeat |

## 9. Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Painel não recebe métricas | `OPS_AGENT_TOKEN` errado | Confirme que o valor no `.env` é idêntico ao secret no painel |
| Comandos ficam em "running" | Agente parado / sem rede | `pm2 status` + `pm2 logs nexengine-ops-agent` |
| `pm2 jlist` retorna vazio | PM2 não está no PATH do user que roda o agente | Rode o agente com o mesmo user que tem o PM2 daemon |
| `docker ps` falha | Usuário sem permissão | `sudo usermod -aG docker $USER` + relogar, ou `DOCKER_ENABLED=false` |
| Workers `offline` no painel | Heartbeat não chega | `pm2 logs nexengine-worker-0` — confira `OPS_AGENT_TOKEN` e `OPS_BASE` |
| Jobs ficam em `processing` para sempre | Worker travou sem completar | `jobs-maintenance` requeue automático após `lease_seconds` |
