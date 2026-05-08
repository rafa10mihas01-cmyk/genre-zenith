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

## 8. Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Painel não recebe métricas | `OPS_AGENT_TOKEN` errado | Confirme que o valor no `.env` é idêntico ao secret no painel |
| Comandos ficam em "running" | Agente parado / sem rede | `pm2 status` + `pm2 logs nexengine-ops-agent` |
| `pm2 jlist` retorna vazio | PM2 não está no PATH do user que roda o agente | Rode o agente com o mesmo user que tem o PM2 daemon |
| `docker ps` falha | Usuário sem permissão | `sudo usermod -aG docker $USER` + relogar, ou `DOCKER_ENABLED=false` |
