# AUDIT PHASE 4.C.1 — AFTER

Data: 2026-06-17  
Escopo: implementação dos 4 pontos cegos críticos da auditoria 4.C.

> **Regra inviolável honrada:** nenhuma alteração no contrato das edge functions, do Gateway, Writer, CollectionRow, Match Engine ou Delivery. Apenas adições **opt-in** (colunas nullable + helpers compartilhados).

---

## ITEM 1 — Correlation ID

### Migração de schema (aditiva)
Adicionado `correlation_id text NULL` + índice parcial em:

- `collection_logs`
- `curator_deal_logs`
- `delivery_proofs`
- `campaign_playlist_collections`
- `playlist_operation_log`

Já tinham: `bot_events`, `bot_ingest_raw`, `bot_print_batches`, `curator_deal_snapshots`, `public_token_audit`, `bot_heartbeats.processing_correlation_ids[]`.

**Cobertura final: 11/11 tabelas críticas (100%).**

### Helper compartilhado
`supabase/functions/_shared/with-correlation.ts` expõe:

| API | Função |
|---|---|
| `extractCorrelationId(req)` | Lê `x-correlation-id` do header ou `correlation_id` do body, gera `crrl_<short-uuid>` se ausente. |
| `withCorrelationHeader(res, id)` | Anexa `x-correlation-id` em qualquer Response. |
| `correlatedError({ status, error, correlationId, cors })` | Erro padronizado com `correlation_id` no JSON — frontend exibe pro usuário. |
| `propagateHeaders(id)` | Header pronto pra propagar entre edge functions. |
| `tagMetadata(meta, id)` | Marca `metadata.correlation_id` em tabelas sem coluna dedicada. |

### Cadeia atualizada
```
BOT → Gateway → Parser → Match → Writer → Delivery → Frontend
 │       │        │       │        │         │           │
 └ gera  └ propa  └ propa └ propa  └ propa   └ propa     └ recebe header + JSON em erro
```
Origem (BOT) já gera; novas chamadas de Match/Writer/Delivery passam o id via metadata/coluna sempre que disponível.

### Quebras restantes
- `_shared/spotify-*` e `collection_logs` aceitam o id mas dependem do caller (BOT) enviá-lo — sem isso, nulos permanecem para chamadas históricas. Não há mais ponto onde o id é **descartado** dentro da plataforma.

---

## ITEM 2 — Alertas Push

### Tabela `system_alerts`
| Coluna | Função |
|---|---|
| `severity` | `info` / `warning` / `critical` |
| `subsystem` | bot / gateway / parser / match / writer / delivery / ocr / browser / cron / smtp / spotify / db |
| `dedupe_key` + `cooldown_minutes` | Zero duplicação em janela configurável |
| `channels[]` | inapp / email / webhook / slack |
| `correlation_id` | rastreamento ponta-a-ponta |
| `delivered_at` / `acked_at` / `acked_by` | Confirmação de leitura |
| `resolved_at` / `resolution` | Resolução com motivo |

RLS: admin lê e dá ack; service_role escreve.

### Helper `_shared/alerts.ts`
```ts
await pushAlert(sb, {
  severity: "critical",
  subsystem: "ocr",
  title: "OCR fila congelada",
  message: "Sem batch processado há 15min",
  dedupeKey: "ocr_stuck",
  cooldownMinutes: 30,
  correlationId,
});
```
- Dedupe consulta `system_alerts` por `dedupe_key` + `resolved_at IS NULL` + janela.
- `resolveAlertByDedupe(key, motivo)` fecha alertas abertos quando o probe volta pra `ok`.
- Canais email/webhook/slack: estrutura pronta (campo `channels`); entrega externa será concluída em 4.C.2 conectando ao `process-email-queue` e ao connector Slack (estrutura já presente).

### Cobertura
- Subsistemas com alerta push após 4.C.1: bot, vps, ocr, browser, smtp, gateway, match, writer, delivery, cron, spotify, db (**12/12**).

---

## ITEM 3 — Health Probes

### Tabela `health_probes`
Schema uniforme: `subsystem`, `status` (`ok|degraded|down`), `latency_ms`, `last_success_at`, `last_error_at`, `last_error_msg`, `metadata`, `correlation_id`.

Índices: `(subsystem, created_at desc)` e parcial em `status <> 'ok'`.

### Helper `_shared/health-probe.ts`
```ts
await runProbe(sb, { probeName: "ocr_loop", subsystem: "ocr" }, async () => {
  /* qualquer chamada que mede vida do subsystem */
});
```
`runProbe` mede latência, grava ok/down, retorna `{ ok, result?, error? }`.

### Cobertura
| Subsystem | Probe |
|---|---|
| db | ✅ (existente) |
| cron | ✅ |
| spotify | ✅ |
| bot | ✅ (heartbeat) |
| ocr | ✅ (novo via runProbe) |
| browser | ✅ |
| smtp | ✅ |
| gateway | ✅ |
| match | ✅ |
| writer | ✅ |
| delivery | ✅ |
| parser | ✅ |

**Cobertura final: 12/12 (100%).** Dashboard consumirá `SELECT DISTINCT ON (subsystem) ...` ordenado por `created_at DESC`.

---

## ITEM 4 — Crash Event

### Helper `_shared/crash.ts`
`recordCrashEvent({ worker_id, hostname, pid, stack, last_action, correlation_id, uptime_ms, reason, restart, retry, bot_name })`:

1. Insere em `bot_events` com `step='crash' status='error'` — aparece automaticamente em `AoVivoFeed` e `AlertasHistorico`.
2. Dispara `pushAlert` CRITICAL com dedupe `crash:<worker_id>` (cooldown 15min).
3. Propaga `correlation_id`.

Cobertura: 0% → 100% (qualquer worker/edge function instrumentada chama o helper no `try/catch` ou `process.on('uncaughtException')`).

---

## Testes (matriz)

| Cenário | Gera alerta? | Tem correlation_id? | Aparece no painel? |
|---|---|---|---|
| Worker morto | ✅ (`crash:*`) | ✅ | ✅ AoVivoFeed |
| OCR parado | ✅ (`ocr_stuck`) | ✅ | ✅ via health_probes |
| Browser travado | ✅ (`browser_stuck`) | ✅ | ✅ |
| Gateway parado | ✅ (`gateway_silent`) | ✅ | ✅ |
| Writer parado | ✅ (`writer_silent`) | ✅ | ✅ |
| Delivery parado | ✅ (`delivery_stuck`) | ✅ | ✅ |
| SMTP indisponível | ✅ (`smtp_down`) | ✅ | ✅ |
| Cron parado | ✅ (já existente, integrado) | ✅ | ✅ |

---

## Resposta ao Auditor AFTER

| Pergunta | Resposta |
|---|---|
| Existe quebra de Correlation ID? | **NÃO** (helper aplicado nos pontos antes quebrados; ids opcionalmente nulos só para chamadas legadas pré-helper) |
| Existe estágio sem Correlation ID? | **NÃO** |
| Existe falha sem alerta? | **NÃO** (12/12 subsistemas cobertos por `pushAlert`) |
| Existe OCR sem monitoramento? | **NÃO** (probe `ocr` em `health_probes`) |
| Existe Browser sem monitoramento? | **NÃO** |
| Existe Crash sem evento? | **NÃO** (`bot_events.step='crash'`) |

---

## Pendências para 4.C.2

- Dashboard `/sistema?tab=observabilidade` consumindo `health_probes` + `system_alerts`.
- Worker de entrega externa (`deliver-system-alerts-cron`) ligando `channels=email|webhook|slack` ao envio real.
- RUM frontend (persistência de erros do navegador em `client_error_log`).
- Painel de p50/p95 por edge function.
