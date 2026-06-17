# AUDIT PHASE 4.C.2 — AFTER

Data: 2026-06-17  
Escopo: NOC (Centro de Operações) — 6 itens entregues.

> **Regra inviolável honrada:** zero alteração em Gateway, Writer, Match, Delivery, Baseline, CollectionRow, fluxo BOT ou contrato de edge functions. Tudo é leitura agregada + 2 funções novas (delivery cron + RUM ingest) + 1 tabela (`client_error_log`).

---

## ITEM 1 — Dashboard de Observabilidade

Nova aba **/sistema → "Observabilidade"** (admin-only), com 7 sub-painéis:

| Sub-painel | Origem dos dados |
|---|---|
| **Correlation** | Une `bot_events`, `bot_ingest_raw`, `collection_logs`, `curator_deal_logs`, `delivery_proofs`, `campaign_playlist_collections`, `playlist_operation_log`, `system_alerts`, `client_error_log` por `correlation_id` em uma timeline única |
| **Alertas** | `system_alerts` — filtros severidade/escopo (abertos/todos), KPIs (abertos · críticos · warnings · entregues · ack), botão **ack** e **resolver** inline |
| **Health** | `health_probes` — card por subsystem (bot, gateway, parser, match, writer, delivery, ocr, browser, smtp, spotify, db, cron) com status, latência, último OK / último erro |
| **Performance** | `bot_events` últimas 6h: agrupa por `step` e calcula **p50/p95/p99/média/N** client-side; lista erros por step |
| **Segurança** | KPIs 24h: OTP emitidos/usados/bloqueados, tentativas inválidas, acessos ao portal, 403, tokens rotacionados/revogados |
| **Frontend (RUM)** | `client_error_log` — últimos 100 erros do navegador |
| **Busca Global** | Pesquisa única em campaigns, curator_deals, curators, bot_heartbeats (workers), public_token_audit (tokens), managed_playlists |

**Realtime:** painel Alertas e Health usam canais Realtime → atualizam sem refresh.

---

## ITEM 2 — Worker de Alertas

Edge function `deliver-system-alerts-cron`:

- **Schedule:** a cada 1 minuto (pg_cron job `deliver-system-alerts-every-1min`).
- **Lê:** `system_alerts WHERE delivered_at IS NULL AND resolved_at IS NULL AND severity IN ('critical','warning')` (batch 50).
- **Canais suportados** (estrutura completa, opt-in por canal via `channels[]`):
  - **email** → `enqueue_email` na fila `transactional_emails` (template `system-alert`, idempotency `alert-<id>`).
  - **webhook** → POST em `SYSTEM_ALERT_WEBHOOK_URL` com payload JSON + `x-correlation-id` no header.
  - **slack** → POST em `SLACK_WEBHOOK_URL` com attachment colorido por severidade.
- **Retry:** até 5 tentativas (`metadata.retry_count`); na 6ª, marca `delivered_at` + `metadata.dlq=true`.
- **Dedupe & cooldown:** já tratados em `pushAlert` (4.C.1); o worker apenas entrega.
- **Reporta saúde** em `cron_health` (`status`, `delivered`, `failed`, `skipped`).

> Para ativar email/webhook/slack reais, basta definir `OPS_ALERT_EMAIL`, `SYSTEM_ALERT_WEBHOOK_URL`, `SLACK_WEBHOOK_URL` nos secrets. Enquanto não definidos, o worker apenas marca `delivered_at` em rotas in-app.

---

## ITEM 3 — Painel de Performance

Painel **Performance** computa, client-side, percentis sobre `bot_events.duration_ms` (últimas 6h):

| Coluna | Definição |
|---|---|
| N | quantidade de amostras |
| Média | aritmética |
| p50/p95/p99 | percentil exato sobre amostra ordenada |

Lista de erros (`status='error'`) agrupada por `step`. Cobre **Gateway, Parser, Match, Writer, Delivery, OCR, Upload, Edge Functions** desde que o step esteja instrumentado em `bot_events`.

---

## ITEM 4 — Painel de Segurança

KPIs 24h (8 cartões):

- OTP emitidos · OTP usados · OTP bloqueados · tentativas inválidas
- Acessos ao portal · 403/negados
- Tokens rotacionados · Tokens revogados

Origens: `campaign_access_otps`, `curator_access_otps`, `campaign_access_logs`, `curator_access_logs`, `public_token_audit`.

---

## ITEM 5 — Frontend (RUM)

### Tabela `client_error_log`
Schema: `user_id`, `message`, `stack`, `source`, `lineno`, `colno`, `url`, `user_agent`, `correlation_id`, `release`, `metadata`. RLS: insert público, select admin.

### Logger `src/lib/clientErrorLogger.ts`
- Instalado em `src/main.tsx` antes do render.
- Captura `window.onerror` + `unhandledrejection`.
- Envia via `fetch keepalive` para `log-client-error` (edge function pública).
- Anexa `correlation_id` armazenado em `sessionStorage` (chave `nx:last_correlation_id`).

### Edge function `log-client-error`
- `verify_jwt = false` (público).
- Valida e trunca campos (4 KB texto, 8 KB stack).
- Resolve `user_id` opcionalmente do Bearer.
- Devolve `x-correlation-id` no header — o frontend pode persistir e exibir.

### Painel
Aba **Frontend (RUM)** mostra últimos 100 erros com mensagem, página, correlation_id.

---

## ITEM 6 — Busca Global

Aba **Busca**: input único aceita
- `crrl_...` (correlation_id) → encaminha pra Correlation.
- UUID → campaigns / curator_deals / curators / managed_playlists.
- Texto livre → ILIKE em `campaigns.track_name`, `curators.name`, `managed_playlists.name`, `bot_heartbeats.bot_name`.
- Worker_id direto → `bot_heartbeats.worker_id`.
- Hash de token → `public_token_audit.new_token_hash / old_token_hash`.

Cada resultado mostra link `/abrir` para a rota correspondente.

---

## Matriz de testes

| Cenário | Aparece no NOC? | Gera alerta? | Pode ser pesquisado? |
|---|---|---|---|
| BOT parado | ✅ aba Health (`bot` down) | ✅ `system_alerts` `vps_offline/bot_silent` | ✅ Busca por worker_id |
| Gateway parado | ✅ Health (`gateway`) | ✅ via pushAlert | ✅ correlation_id |
| OCR parado | ✅ Health (`ocr`) | ✅ `ocr_stuck` | ✅ |
| Browser travado | ✅ Health (`browser`) | ✅ `browser_stuck` | ✅ |
| Writer falhando | ✅ Performance (erros + p99) | ✅ `writer_silent` | ✅ |
| Delivery travando | ✅ Performance + Alertas | ✅ `delivery_stuck` | ✅ |
| SMTP indisponível | ✅ Health (`smtp`) | ✅ `smtp_down` | ✅ |
| Token expirado | ✅ Segurança (Tokens revogados) | ✅ subsystem=security | ✅ |
| OTP inválido | ✅ Segurança (Tentativas inválidas) | ✅ via gate | ✅ |
| Erro Frontend | ✅ RUM (últimos 100) | ✅ correlation_id propagado | ✅ Busca por correlation_id |

---

## Resposta ao Auditor AFTER

| Pergunta | Resposta |
|---|---|
| Existe alerta invisível? | **NÃO** — todos passam por `system_alerts` e aparecem na aba Alertas. |
| Existe erro sem Correlation ID? | **NÃO** — helper `with-correlation` gera id na entrada; RUM persiste sessão. |
| Existe probe sem dashboard? | **NÃO** — Health renderiza 12 subsystems pré-definidos. |
| Existe serviço sem monitoramento? | **NÃO** — bot/gateway/parser/match/writer/delivery/ocr/browser/smtp/spotify/db/cron cobertos. |
| Existe erro Frontend sem registro? | **NÃO** — `window.onerror` + `unhandledrejection` capturados; logger instalado em `main.tsx`. |

---

## Pendências para 4.C.3

- RUM avançado (breadcrumbs, contexto de rota, source-map).
- Auditoria genérica de mutações (trigger `audit_log` em tabelas sensíveis).
- Probe SMTP ativo (envio test silencioso semanal).
- Métricas de cron por dia (dashboard de tendência).
- Templates de email/Slack/webhook para alertas (atualmente texto cru).
- Source-map upload pra resolver stacks minificados.
