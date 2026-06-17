# NexEngine — Runbooks Operacionais

Versão 1.0 · 2026-06-17 · Fase 4.C.3

Cada runbook responde quatro perguntas: **Como identificar · Como validar · Como recuperar · Tempo esperado**.
Todos os alertas chegam por `system_alerts` (severity `critical` ou `warning`) e são entregues por `deliver-system-alerts-cron` (email/Slack/webhook conforme `OPS_ALERT_EMAIL` / `SLACK_WEBHOOK_URL`).

> Em todo procedimento abaixo, use o `correlation_id` do alerta para filtrar logs em `bot_events`, `delivery_proofs`, `playlist_operation_log`, `client_error_log` e `cron_run_log`.

---

## 1. BOT OFFLINE
- **Identificar:** alerta `severity=critical, subsystem=bot, dedupe_key=bot:heartbeat:stale`; `bot_heartbeats.last_seen_at` > 5 min atrás.
- **Validar:** `SELECT * FROM bot_heartbeats WHERE last_seen_at < now() - interval '5 min'` → confirma worker(s) afetado(s).
- **Recuperar:** reiniciar o worker na VPS correspondente (`vps_nodes.host`); checar `bot_events` para `step='crash'` recente.
- **Tempo esperado:** detecção ≤ 2 min · recuperação ≤ 5 min.

## 2. OCR DOWN
- **Identificar:** `system_alerts` `subsystem=ocr` ou `health_probes` `subsystem='ocr', status='fail'`.
- **Validar:** rodar `runProbe('ocr')` manualmente via `/sistema → Observabilidade → Health → re-probe`.
- **Recuperar:** reiniciar serviço OCR (worker dedicado); validar com um print de teste; fallback manual via `manual-fallback.ts` ativo.
- **Tempo esperado:** detecção ≤ 2 min · recuperação ≤ 10 min.

## 3. Browser DOWN
- **Identificar:** `health_probes.subsystem='browser', status='fail'` por > 2 ciclos.
- **Validar:** checar logs do headless (Playwright/Puppeteer) na VPS; verificar memória.
- **Recuperar:** restart container browser; limpar `/tmp/chromium-profiles`.
- **Tempo esperado:** detecção ≤ 5 min · recuperação ≤ 10 min.

## 4. Gateway DOWN
- **Identificar:** alerta `subsystem=gateway, dedupe_key=gateway:down`; p95 latência em `health_probes` acima de 5s.
- **Validar:** `curl` ao endpoint de gateway; checar `spotify_circuit_breaker.state`.
- **Recuperar:** se circuit_breaker `open`, aguardar cooldown; rotear tráfego pra app secundário (`spotify_apps.priority`).
- **Tempo esperado:** detecção ≤ 1 min · recuperação ≤ 5 min.

## 5. Writer DOWN
- **Identificar:** `system_alerts` `subsystem=writer` ou ausência de inserts em `playlist_operation_log` por > 10 min.
- **Validar:** `SELECT count(*) FROM playlist_operation_log WHERE created_at > now() - interval '10 min'`.
- **Recuperar:** checar fila `playlist_operation_queue` por jobs `status='error'`; reprocessar via `process-playlist-queue-cron`.
- **Tempo esperado:** detecção ≤ 3 min · recuperação ≤ 10 min.

## 6. Delivery DOWN
- **Identificar:** alerta `subsystem=delivery` ou `delivery_proofs` sem novos registros por > 15 min em horário de operação.
- **Validar:** inspecionar `curator_deal_delivery_status` por entregas `status='pending'` antigas.
- **Recuperar:** reexecutar `delivery-worker` manualmente; cruzar com `audit_log` se houve mudança recente em `pricing_settings`.
- **Tempo esperado:** detecção ≤ 5 min · recuperação ≤ 15 min.

## 7. SMTP DOWN
- **Identificar:** alerta `dedupe_key=smtp:probe:down` gerado por `smtp-health-probe-cron`.
- **Validar:** `SELECT * FROM health_probes WHERE subsystem='smtp' ORDER BY created_at DESC LIMIT 5`.
- **Recuperar:** verificar credenciais (`SMTP_HOST/USER/PASS`); checar bloqueio do provedor; usar provedor de fallback (configurar `OPS_ALERT_EMAIL` em outro relay).
- **Tempo esperado:** detecção ≤ 5 min · recuperação ≤ 20 min.

## 8. Cron parado
- **Identificar:** ausência de novos `cron_run_log` para `cron_name` específico em janela > 2× intervalo agendado.
- **Validar:** `SELECT cron_name, max(started_at) FROM cron_run_log GROUP BY 1 ORDER BY 2`; checar `cron.job` no schema `cron`.
- **Recuperar:** re-agendar via `cron.schedule(...)`; rodar a edge function manualmente uma vez para popular histórico.
- **Tempo esperado:** detecção ≤ 5 min · recuperação ≤ 5 min.

---

## Apêndice A — Auditoria de mutações (`audit_log`)

- Quem mudou um deal recentemente?
  `SELECT actor_id, occurred_at, diff_keys, before_data, after_data FROM audit_log WHERE table_name='curator_deals' AND row_pk='<uuid>' ORDER BY occurred_at DESC LIMIT 20;`
- Cobertura: `curator_deals`, `curator_deal_songs`, `campaigns`, `clients`, `curators`, `system_alerts`, `system_flags`, `pricing_settings`.
- Política: retenção indefinida (admin). Para purga futura, criar `cron.schedule('audit-log-prune', ...)`.

## Apêndice B — Source maps

- Build Vite produz `.map` junto ao bundle.
- `client_error_log` grava `stack`, `commit_sha`, `source`, `lineno`, `colno`.
- Para resolver localmente: baixe os `.map` do release correspondente e use `source-map-cli`:
  ```
  npx source-map-cli resolve dist/assets/index-<hash>.js.map <lineno> <colno>
  ```
- Política de retenção dos `.map`: 30 dias por release ativo.
- Variáveis necessárias: `VITE_APP_RELEASE`, `VITE_APP_COMMIT` (definidas no pipeline).

## Apêndice C — Alertas: estrutura

```
{
  severity: 'critical' | 'warning' | 'info',
  subsystem: 'bot' | 'ocr' | 'browser' | 'gateway' | 'writer' | 'delivery' | 'smtp' | 'cron' | ...,
  title: string,
  detail: string,
  dedupe_key: string,    // controla cooldown
  cooldown_minutes: number,
  correlation_id: string,
}
```

Operações suportadas no painel `/sistema → Observabilidade → Alerts`: Ack, Resolve, filtro por subsystem/severity, busca por `correlation_id`.
