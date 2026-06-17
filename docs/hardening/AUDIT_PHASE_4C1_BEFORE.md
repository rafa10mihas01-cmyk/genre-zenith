# AUDIT PHASE 4.C.1 — BEFORE

Data: 2026-06-17  
Escopo: 4 pontos cegos críticos da auditoria 4.C.

## Estado inicial

### 1) Correlation ID
| Tabela | tem `correlation_id`? |
|---|---|
| bot_events | ✅ |
| bot_ingest_raw | ✅ |
| bot_print_batches | ✅ |
| curator_deal_snapshots | ✅ |
| public_token_audit | ✅ |
| collection_logs | ❌ |
| curator_deal_logs | ❌ |
| delivery_proofs | ❌ |
| campaign_playlist_collections | ❌ |
| playlist_operation_log | ❌ |

- Sem helper compartilhado.
- Nenhuma edge function devolve `x-correlation-id`.
- Frontend não recebe `correlation_id` em erros.

### 2) Alertas push
- Apenas `notifications` in-app (sino) + `ops-alerts-cron-every-5min` (limitado a `bot_silent` e `vps_offline`).
- Sem fila oficial com severidade/dedupe/ack/resolução.
- Sem suporte a email/webhook/slack como canais primeira-classe.
- Subsistemas sem alerta: gateway, parser, match, writer, delivery, ocr, browser, smtp, spotify (parcial), db.

### 3) Health checks
- ✅ db (`db_health`), cron (`cron_health`), spotify (`spotify_circuit_breaker`), bot (heartbeat), VPS (heartbeat).
- ❌ ocr, browser, smtp, gateway, match, writer, delivery, parser — sem probe oficial; sem histórico; sem dashboard dedicado.

### 4) Crash event
- Não existe `step='crash'` em `bot_events`.
- Detecção é inferida por ausência de heartbeat (≥10min).
- Sem `pid`/`stack`/`last_action`/`uptime`/`retry`/`restart` registrados.

## Métricas baseline

| Item | Valor |
|---|---|
| Cobertura correlation_id (tabelas críticas) | 5/11 (45%) |
| Cobertura alertas (subsistemas críticos) | 2/12 (17%) |
| Cobertura health probes | 5/13 (38%) |
| Crash explícito | 0% |
| MTTD (falha crítica média) | 15–45 min |
| MTTR (root cause analyst) | 15–45 min |
| Nível de observabilidade | 6.5 / 10 |

## Pontos cegos confirmados
1. Quebra de correlação em Match→Writer→Delivery→Frontend.
2. Sem alerta push fora de bot/vps.
3. OCR / browser / SMTP sem probe.
4. Crash silencioso.
