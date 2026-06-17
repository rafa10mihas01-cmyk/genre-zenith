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

### 3.1 Prints e DOM payload (anti-duplicata e anti-overshoot)

Regras obrigatórias do worker ao montar `dom_payload` e enviar prints:

1. **Enquadramento obrigatório antes de qualquer print**: ajustar o navegador para
   **zoom 25%** (aceito somente 25–26%), viewport alvo **1440×1550** quando
   disponível, e capturar em modo viewport. A evidência correta precisa mostrar
   **22–23 playlists por print**; a primeira parte deve incluir o cabeçalho da
   música + início da lista. Print com 3–5 playlists grandes (zoom 100%/página
   “normal”) é inválido para esse fluxo.
2. **Scroll até o fim da lista virtualizada**. Pare quando:
   - `playlistCount` lido do header **≤** itens já capturados, **OU**
   - 3 scroll-passes consecutivos sem novo `data-testid="row"` aparecer.
3. **Nunca duplicar** linhas no `dom_payload`: dedup por `spotify_playlist_id`
   (e por `algo:<nome>` para Radio/Mixes/Smart Shuffle).
4. **Nunca enviar prints redundantes**. `total_parts` deve ser **exatamente**
   `ceil(linhas_únicas / linhas_por_print)`. Se a tela cabe em 4 prints, não
   mande 6 — o ingest passou a deduplicar internamente, mas prints sobrando
   geram storage lixo e custo de IA.
5. **Ordem dos prints** monotônica (parte 1 = topo, parte N = fundo).
6. Se `playlistCount` do header divergir do capturado, emitir `DISCARDED`
   com `discard_reason="scroll_incomplete"` em vez de mandar payload parcial.

Sequências de erro:

```
... → FAILED       (qualquer falha; message obrigatória)
... → DISCARDED    (item rejeitado deliberadamente; discard_reason OBRIGATÓRIO)
```

### Estados válidos
`FETCHED | ACCEPTED | QUEUED_LOCAL | STARTED | PRINT_UPLOADED | SNAPSHOT_SENT | FINISHED | FAILED | DISCARDED`

Estado fora dessa lista é silenciosamente normalizado para `null` pelo endpoint
(o linter do banco rejeita valores fora do enum).

## 3.2. Baseline de campanha interna — PROIBIDO total agregado

Quando `bot-collect-queue` devolver `requires_playlist_breakdown: true` ou
`capture_mode: "playlist_breakdown_required"`, o worker NÃO pode enviar o payload
legado `{ plays: N }` para `bot-ingest-snapshot`.

Esses jobs são baseline/monitoramento de campanha interna e exigem o formato novo:

- abrir a página **Playlists** da música no Spotify for Artists;
- rolar até capturar todas as linhas;
- enviar `snapshots[]` por playlist para `bot-ingest-snapshot`, **ou** prints
  `playlists-part-X-of-Y` via `bot-upload-print` com `dom_playlists`.

Para coletas grandes, **1 print não é evidência válida**: se o payload trouxer
mais de 30 playlists e só `screenshot_url`, o backend rejeita com
`422 multi_print_required`. O worker deve enviar todas as partes em
`print_urls[]` ou usar `bot-upload-print` com labels `playlists-part-X-of-Y`.

Se o worker mandar apenas total agregado nesses jobs, o backend responde
`422 playlist_breakdown_required` e não grava baseline agregada.

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

---

## 9. Loop de execução (ADD automático em playlist) — NOVO

Loop **independente** do coletor. Mesma sessão Spotify (`stela.ladosulmusic@gmail.com`),
mas processo/timer separado. Coleta é read-only; execução é mutação. Não compartilhar
lock nem fila com `bot-collect-queue`.

### 9.1. Endpoints

Auth: `x-bot-key` (mesma chave do coletor). Headers de identidade obrigatórios:
`x-worker-id`, `x-process-id`, `x-hostname`, `x-timer-id` (use `execution-loop`),
`x-bot-name`, `x-bot-session`.

#### `GET /functions/v1/bot-execution-queue?limit=3`

Resposta:
```json
{
  "ok": true,
  "count": 1,
  "queue": [
    {
      "id": "<job_uuid>",
      "job_type": "playlist.track.add",
      "correlation_id": "<uuid>",
      "spotify_playlist_id": "37i9dQ...",
      "spotify_track_id": "4uLU6h...",
      "allocation_id": "<uuid>",
      "attempts": 1,
      "max_attempts": 3
    }
  ]
}
```

O endpoint já marca cada job como `claimed` com lease de 5min e gera o
`correlation_id`. Não precisa fazer outro POST de "aceito".

#### `POST /functions/v1/bot-execution-complete`

Body:
```json
{
  "job_id": "<uuid>",
  "correlation_id": "<uuid>",
  "status": "done" | "failed",
  "error": "<string opcional, obrigatória se failed>"
}
```

- `done` → marca job concluído e atualiza o status da `campaign_eco_allocations` correspondente.
- `failed` → re-enfileira com backoff exponencial (2min, 8min, 30min, ...) até `max_attempts`.
  Depois disso vira `failed` definitivo e exige retry manual pelo painel.

### 9.2. Fluxo do worker de execução

```
loop {
  jobs = GET /bot-execution-queue?limit=3
  for job in jobs:
    try:
      page.goto(`https://open.spotify.com/playlist/${job.spotify_playlist_id}`)
      adicionar faixa via UI (search por spotify:track:<id>)
      validar que faixa apareceu na lista
      POST /bot-execution-complete { job_id, correlation_id, status: 'done' }
    catch err:
      POST /bot-execution-complete { job_id, correlation_id, status: 'failed', error: str(err) }
  sleep(15s) se queue vazia, 2s caso contrário
}
```

### 9.3. Regras

- **Nunca silent return**. Toda tarefa recebida tem que terminar com `done` OU `failed`.
  Se o worker decidir não executar (sessão expirada, playlist não encontrada, faixa já
  presente) → manda `failed` com `error` descritivo. O backoff/limite cuidam do resto.
- **Detecta "faixa já presente"** antes de tentar adicionar. Se já estiver na playlist,
  retorna `done` (operação idempotente do ponto de vista do plano).
- **Lease de 5min**: se o worker travar, o próprio `bot-execution-queue` reenfileira
  automaticamente quando outro worker for buscar. Sem ação manual.
- **Headers de identidade ausentes** não bloqueiam, mas zeram a rastreabilidade no painel.

### 9.4. Painel

`/sistema → Execução` mostra a fila em tempo real (KPIs + tabela com retry/cancelar).
Toda chamada do worker gera `bot_events` (`lifecycle_state` + `correlation_id`)
exatamente como o coletor — mesma ferramenta de debug.

