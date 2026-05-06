# Contrato Bot VPS ↔ Endpoint Lovable (Fase A — Observabilidade)

> **Objetivo:** rastreabilidade determinística ponta a ponta, sem ambiguidade.
> Esta fase **não** muda comportamento do worker (timeout/retry/recovery permanecem como estão).
> Só adiciona **propagação de `correlation_id`** + **lifecycle events explícitos**.

---

## 1. Identidade do dispatch: `correlation_id`

- Gerado pelo **endpoint** (`bot-collect-queue`) — UUID v4.
- Devolvido em cada item da fila:
  ```json
  GET /functions/v1/bot-collect-queue?limit=5
  → { "queue": [ { "id": "<song_id>", "correlation_id": "<uuid>", ... } ] }
  ```
- O bot **DEVE** propagar esse `correlation_id` em **todos** os eventos, uploads e
  qualquer chamada subsequente referente àquele item.
- **Nunca** invente, reutilize ou descarte um `correlation_id`.

## 2. Headers / fields obrigatórios

| Endpoint | Como enviar correlation_id |
|---|---|
| `POST /bot-event-ingest` | campo `correlation_id` no JSON do evento |
| `POST /bot-upload-print` | header `x-correlation-id: <uuid>` **ou** `correlation_id` no form-data/query |
| `POST /bot-heartbeat`    | campo opcional `processing_correlation_ids: string[]` (lista do que está sendo processado) |

## 2.1. Identidade do worker — OBRIGATÓRIO em todas as chamadas

A auditoria confirmou múltiplos pollers chamando a fila ao mesmo tempo. Toda
request da VPS DEVE enviar:

| Header | Conteúdo |
|---|---|
| `x-worker-id`  | id lógico do worker (ex: `worker-A`) |
| `x-process-id` | PID do SO |
| `x-hostname`   | hostname da máquina |
| `x-timer-id`   | id do timer/loop que disparou (ex: `poll-30s`, `recovery-watchdog`) |
| `x-bot-name`   | identificador do bot |
| `x-bot-session`| id da sessão atual do navegador |

Aceito por: `bot-collect-queue`, `bot-event-ingest`, `bot-upload-print`, `bot-heartbeat`.
Persistido como colunas dedicadas em `bot_events` e `bot_heartbeats`.
Headers ausentes não bloqueiam, mas aparecem como `UNKNOWN` no `v_dispatch_trace`.

## 3. Lifecycle obrigatório (`POST /bot-event-ingest`)

```json
{
  "deal_id": "...",
  "song_id": "...",
  "correlation_id": "<uuid>",
  "lifecycle_state": "<STATE>",
  "step": "<short label>",
  "status": "running" | "success" | "error",
  "message": "<opcional>",
  "duration_ms": 1234,
  "metadata": { ... }
}
```

Sequência canônica de um dispatch bem-sucedido:

```
FETCHED         (gerado pelo endpoint, em bot-collect-queue)
  ↓
ACCEPTED        (bot recebeu e validou item)
  ↓
QUEUED_LOCAL    (bot colocou na fila interna do worker)
  ↓
STARTED         (worker iniciou navegação)
  ↓
PRINT_UPLOADED  (gerado pelo endpoint quando bot-upload-print recebe parte)
  ↓
SNAPSHOT_SENT   (gerado pelo endpoint quando extract grava snapshots)
  ↓
FINISHED        (gerado pelo endpoint após extract concluir)
```

Sequências de erro:

```
... → FAILED       (qualquer falha; message obrigatória)
... → DISCARDED    (item rejeitado deliberadamente; discard_reason OBRIGATÓRIO)
```

### Estados válidos
`FETCHED | ACCEPTED | QUEUED_LOCAL | STARTED | PRINT_UPLOADED | SNAPSHOT_SENT | FINISHED | FAILED | DISCARDED`

Estado fora dessa lista é silenciosamente normalizado para `null` pelo endpoint
(o linter do banco rejeita valores fora do enum).

## 4. Regra crítica: nunca silent return

Se o worker decidir **não processar** um item recebido — por qualquer motivo
(janela bloqueada, sessão Spotify expirada, item duplicado, rate-limit interno,
deal pausado já capturado, etc.) — é **obrigatório** emitir:

```json
{
  "correlation_id": "...",
  "lifecycle_state": "DISCARDED",
  "discard_reason": "<motivo curto e específico>",
  "message": "<contexto opcional>"
}
```

`discard_reason` faz parte do contrato. Sem ele o evento será aceito, mas o time
de plataforma trata como bug do bot e abre alerta.

## 5. Heartbeat enriquecido (opcional mas recomendado)

```json
POST /bot-heartbeat
{
  "spotify_session_valid": true,
  "processing_correlation_ids": ["<uuid1>", "<uuid2>"]
}
```

Permite ao endpoint provar, a qualquer momento: "esse correlation_id ainda está
ativo no worker" vs. "sumiu sem FAILED/FINISHED" — fechando a anomalia
"queue:0 no heartbeat enquanto endpoint achava que tinha 1 queued".

## 6. Visão de debug — `v_dispatch_trace`

Disponível no banco (Lovable Cloud). Para qualquer `correlation_id`:

```sql
SELECT * FROM v_dispatch_trace WHERE correlation_id = '<uuid>';
```

Retorna timestamps de cada lifecycle, o batch de prints relacionado e a
contagem de snapshots gerados. É a **única** ferramenta autorizada para
diagnosticar "cadê o dispatch X" — não confiar em logs textuais.

## 7. O que NÃO muda nesta fase

- Timeout do `bot-collect-queue` recovery (3 min) → mantido.
- Política de retry do worker → mantida.
- `verify_jwt`, headers existentes, autenticação `x-bot-key` / `x-bot-token` → mantidos.
- Cálculos de progress/financeiro/baseline → mantidos.

## 8. Fase B (futura, depende desta fase)

Só após termos prova determinística de pelo menos 50 dispatches completos
(`v_dispatch_trace.finished_at IS NOT NULL`) é que se discute alterar
timeout/retry/recovery. Não antes.
