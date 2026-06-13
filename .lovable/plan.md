# Arquitetura de Execução do Catálogo — Plano Final

Desenho da esteira que transforma `catalog_placements` em adições reais no Spotify, sem rate limit, sem explosão de concorrência e com retry/observabilidade.

**Princípio central:** `catalog_placements` continua sendo **estado de negócio** (o que deve existir nas playlists). A **execução** vive numa fila separada (`catalog_execution_queue`) consumida por workers batched. Cadastrar música = transacional (segundos). Executar = assíncrono (minutos/horas).

---

## 1. Schema da fila

### Tabela nova: `catalog_execution_queue`

| coluna | tipo | descrição |
|---|---|---|
| `id` | uuid PK | |
| `placement_id` | uuid FK → `catalog_placements(id)` ON DELETE CASCADE, UNIQUE | 1 placement = no máx 1 job vivo |
| `catalog_track_id` | uuid FK → `catalog_tracks(id)` | índice — agregação por música |
| `playlist_id` | uuid FK → `managed_playlists(id)` | índice — limite por playlist |
| `owner_account_id` | uuid FK → `accounts(id)` | índice — limite por owner/token |
| `operation` | text | `add_track` (futuro: `remove_track`, `reorder`) |
| `priority` | smallint | 1 = híbrida, 2 = catálogo puro (menor = mais alta) |
| `status` | text | `pending` \| `processing` \| `retry` \| `completed` \| `failed` |
| `attempts` | int default 0 | |
| `max_attempts` | int default 6 | |
| `retry_at` | timestamptz | quando pode voltar a ser elegível (backoff) |
| `locked_at` | timestamptz | claim time |
| `locked_by` | text | `worker_id` |
| `lease_expires_at` | timestamptz | claim + 2min, recuperado por reaper |
| `last_error` | text | |
| `last_error_code` | text | `429`, `5xx`, `circuit_open`, `401`, `403`, `404`, `owner_invalid`, etc. |
| `executed_at` | timestamptz | momento do addTracks bem-sucedido |
| `confirmed_at` | timestamptz | momento da reconsulta confirmando presença |
| `created_at` / `updated_at` | timestamptz | |

**Índices:**
- `(status, priority, retry_at)` — query principal de claim
- `(owner_account_id, status)` — limite por owner
- `(playlist_id, status)` — limite por playlist
- `(catalog_track_id)` — métricas por música

**Estados — máquina:**
```text
pending ──claim──► processing ──ok──► completed
                       │
                       ├──erro retryable──► retry ──(retry_at)──► pending
                       │
                       └──erro fatal──► failed
```

**Sincronização com `catalog_placements.status`:** trigger atualiza `catalog_placements.status` quando o job termina (`completed` → `active`, `failed` → `failed`), e seta `added_at` no `confirmed_at`. `catalog_placements` continua sendo a fonte de verdade do negócio.

---

## 2. Estratégia de consumo

| parâmetro | valor inicial | racional |
|---|---|---|
| batch por tick (worker) | **50 jobs** | Spotify add-tracks aceita até 100 IDs por playlist; 50 jobs distribuídos em ~20-30 playlists ≈ 20-30 chamadas |
| concorrência interna | **5 chamadas paralelas** | mantém latência baixa sem saturar token |
| limite por owner | **máx 20 jobs `processing`+`pending`-claimed por owner por minuto** | distribui carga entre tokens |
| limite por playlist | **1 job `processing` por playlist** | evita ordering issues no mesmo playlist |
| agrupamento | dentro do batch, agrupar por `(playlist_id, owner)` e usar 1 chamada `POST /playlists/{id}/tracks` com até 100 IDs | reduz drasticamente chamadas |
| circuit breaker aberto | worker **NÃO consome** jobs do owner afetado, agenda `retry_at = breaker.recover_at + jitter` | breaker já existe em `spotify_circuit_breaker` |
| `Retry-After` (429) | parsear header, marcar job `retry` com `retry_at = now + Retry-After + jitter(0-30s)`, e abrir breaker leve no owner por esse período | |

**Claim via `FOR UPDATE SKIP LOCKED`** (padrão já documentado em `SCALE_HOTSPOTS.md`):

```sql
WITH next AS (
  SELECT id FROM catalog_execution_queue
  WHERE status IN ('pending','retry')
    AND (retry_at IS NULL OR retry_at <= now())
    AND owner_account_id NOT IN (<owners com breaker aberto>)
  ORDER BY priority ASC, created_at ASC
  LIMIT 50
  FOR UPDATE SKIP LOCKED
)
UPDATE catalog_execution_queue q
SET status='processing', locked_at=now(), locked_by=$1,
    lease_expires_at=now()+interval '2 minutes', attempts=attempts+1
FROM next WHERE q.id=next.id RETURNING q.*;
```

---

## 3. Priorização

Calculada **no momento do enqueue** (não dinamicamente) e gravada em `priority`:

- **Prioridade 1 (híbrida):** playlist tem `managed_playlists.is_hybrid = true` OU já tem ≥1 `curator_deal_songs` ativo apontando para ela (= playlist que também roda deal pago, qualquer atraso é visível para curador/cliente)
- **Prioridade 2 (catálogo puro):** todas as outras

Tie-breaker dentro da mesma prioridade: `created_at ASC` (FIFO). Música mais antiga na fila roda primeiro.

A query de claim ordena `ORDER BY priority ASC, created_at ASC` — híbridas drenam antes.

---

## 4. Retry e classificação de erro

| código HTTP / situação | classe | ação |
|---|---|---|
| `429` Too Many Requests | retryable | `retry`, backoff = `Retry-After` + jitter, abre breaker do owner |
| `500/502/503/504` | retryable | `retry`, backoff exponencial |
| Timeout / network | retryable | idem 5xx |
| `circuit_open` (pré-call) | retryable | `retry_at = breaker.recover_at` |
| `401` token expirado | retryable 1x | tenta refresh; se refresh falha → `failed` |
| `403` forbidden | **fatal** | `failed`, marca `owner_invalid` no log |
| `404` playlist/track não existe | **fatal** | `failed`, marca placement como `invalid` |
| `400` payload inválido | **fatal** | `failed` |

**Backoff exponencial** (mesmo padrão de `playlist-queue.ts`):
```text
attempt 1 → 2 min
attempt 2 → 8 min
attempt 3 → 32 min
attempt 4 → 2 h
attempt 5 → 8 h
attempt 6 → 24 h   (último; depois → failed)
```
Com jitter ±20% para evitar thundering herd.

**Recuperação de lease:** reaper roda a cada minuto e devolve para `pending` jobs com `lease_expires_at < now() AND status='processing'`.

---

## 5. Cron — frequência

**Decisão: a cada 1 minuto.**

Justificativa:
- 50 jobs/tick × 60 ticks/h × 24h = **72.000 placements/dia** de teto teórico — folga grande
- Latência percebida boa (música cadastrada aparece nas playlists em poucos minutos)
- Custo de invocação edge function desprezível
- Se a fila estiver vazia, o worker termina em <1s (claim retorna 0 linhas) — não há desperdício
- Reaper de leases roda no mesmo tick (ou em cron separado, indiferente)

`pg_cron` chama `process-catalog-execution-queue` (worker batched) a cada minuto. Sem fire-and-forget no `distribute-catalog-track`.

---

## 6. Confirmação pós-execução

Fluxo de um job bem-sucedido:

```text
claim job
  │
  ▼
agrupa por playlist_id (até 100 track_ids)
  │
  ▼
POST /v1/playlists/{id}/tracks  (com snapshot_id se disponível)
  │
  ├── 2xx → marca executed_at = now()
  │
  ▼
GET  /v1/playlists/{id}/tracks?fields=items(track(id))&limit=100  (top do playlist; adição vai no topo por padrão)
  │
  ├── track_id presente → status=completed, confirmed_at=now()
  │                       trigger: catalog_placements.status='active', added_at=confirmed_at
  │
  └── track_id ausente  → status=retry, last_error='not_confirmed', attempts++
```

Detalhes:
- A reconsulta usa o **mesmo token** da chamada de add para evitar cache de owner diferente
- Resultado da reconsulta vai para `catalog_placement_execution_log` (auditoria já existe)
- Se 3 reconsultas seguidas não confirmarem → `failed` com `last_error='ghost_add'` (sinal de problema com a playlist, vai pro Cockpit)

---

## 7. Cockpit — métricas

### Por música (view `v_catalog_track_execution_stats`, agregando por `catalog_track_id`):
- `total` (= placements totais)
- `ativos` (placements `active` / queue `completed`)
- `pendentes` (queue `pending`)
- `processando` (queue `processing`)
- `retry` (queue `retry` + próximo `retry_at`)
- `falhas` (queue `failed` agrupado por `last_error_code`)
- `eta_estimado` = `pendentes / throughput_global * 1min`

### Global (card no Cockpit + aba na `/sistema`):
- Fila total (`pending + retry + processing`)
- Throughput últimos 5 / 60 min (`completed/min`)
- Última execução do worker (heartbeat)
- Top 5 owners com mais retry
- Top 5 erros (`last_error_code` count)
- Estado do circuit breaker por owner

Realtime via `postgres_changes` em `catalog_execution_queue` para a tabela do `MusicasTab`.

---

## 8. Escala — projeção

**Cenário alvo:** 900 playlists × 5.000 músicas, distribuição parcial → 50.000 placements totais ativos, picos de cadastro de 500-2.000 placements de uma vez.

| dimensão | cálculo | resultado |
|---|---|---|
| Throughput nominal | 50 jobs/min × agrupamento 3× (jobs por playlist) | **~150 placements/min** efetivos |
| Drenar pico de 2.000 | 2.000 / 150 | **~14 min** |
| Drenar backlog de 50.000 | 50.000 / 150 / 60 | **~5h30** (worst-case primeira carga) |
| Tamanho da tabela em regime | 50k linhas ativas + ~3 meses histórico completed → ~300k | **trivial** com índices certos |
| Pressão no Spotify | ~50 chamadas/min divididas entre N owners | **bem abaixo** do limite por token |
| Custo edge | 1.440 invocações/dia × <2s = ~48 min CPU/dia | **desprezível** |

**Gargalos potenciais e mitigação:**
- **1 owner concentra tudo:** limite por owner empurra para retry, throughput cai mas não quebra. Mitigação real: distribuir playlists entre mais owners.
- **Playlist com 10k tracks:** `GET /tracks` de confirmação fica caro. Mitigação: confirmar só os 100 primeiros (adição vai no topo) — já previsto.
- **Storage:** `catalog_placement_execution_log` cresce. Mitigação: incluir no `cleanup_operational_logs()` (TTL 90 dias para `completed`, infinito para `failed`).
- **Operações > add (futuro remove/reorder):** schema já prevê `operation`; lógica do worker é um `switch`.

---

## 9. O que NÃO entra agora (decidido)

- Sem priorização dinâmica (recalc por idade etc) — `priority` é fixa no enqueue
- Sem fila distribuída externa (Redis/SQS) — Postgres + `SKIP LOCKED` aguenta o volume projetado
- Sem múltiplos workers de catálogo simultâneos — 1 worker batched + cron é suficiente; arquitetura suporta N quando precisar (basta cron com `worker_id` diferente, `SKIP LOCKED` cuida do resto)
- Sem operações de remove/reorder — schema preparado, lógica em fase posterior

---

## 10. Próximos passos (após aprovação)

Sequência de implementação, cada etapa independente e revisável:

1. **Migration:** criar `catalog_execution_queue`, índices, trigger de sync com `catalog_placements`, view `v_catalog_track_execution_stats`
2. **Enqueue:** ajustar `distribute-catalog-track` para criar 1 linha em `catalog_execution_queue` por placement criado, com `priority` calculada (transacional, mesmo request — continua segundos)
3. **Worker:** nova edge `process-catalog-execution-queue` — claim com `SKIP LOCKED`, agrupa por playlist, executa, confirma, escreve log
4. **Reaper:** `reap-catalog-queue` (ou reuso de `jobs-maintenance`) recupera leases expirados
5. **Cron:** `pg_cron` 1/min para worker, 1/min para reaper
6. **Cockpit:** métricas por música no `MusicasTab` + aba global no `/sistema`
7. **Cleanup:** estender `cleanup_operational_logs()` para purga de `completed` antigos

Nada disso é codado agora. Aguardando aprovação ponto a ponto ou do plano inteiro.