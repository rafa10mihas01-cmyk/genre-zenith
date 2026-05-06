## FASE 6 — Estabilidade, Observabilidade e Preparação para Escala

Objetivo: dar visibilidade operacional + retenção controlada + mapeamento para escala futura, **sem mudar comportamento** do tracking/snapshots/whitelist/cálculo.

---

### 1. Tabela única de métricas operacionais

Criar `ops_metrics` para centralizar telemetria de TODAS as operações (importação, OCR, RPC, coleta, edge calls):

```
ops_metrics (
  id uuid pk,
  created_at timestamptz default now(),
  scope text          -- 'edge_function' | 'rpc' | 'bot' | 'collect' | 'import' | 'ocr'
  operation text      -- 'register-curator-playlist' | 'extract-snapshot-from-print' | etc
  status text         -- 'success' | 'error' | 'timeout' | 'rate_limited'
  duration_ms int
  deal_id uuid null
  song_id uuid null
  metadata jsonb default '{}'  -- payload livre (size, retries, error_msg curto)
)
```

Index em `(scope, operation, created_at desc)` e `(status, created_at desc)`.
RLS: leitura para team; insert via service role (sem RLS de insert para edge functions com service key).

Helper `_shared/ops-metrics.ts` (`recordMetric({...})`) — chamado nos hot-paths já existentes:
- `register-curator-playlist` (duration total + spotify retries)
- `bot-ingest-snapshot` (duration RPC)
- `bot-upload-print` (storage upload + signed url)
- `extract-snapshot-from-print` (OCR/Gemini timing)
- `bot-collect-queue` (queue size, blocked count)

Falha NÃO bloqueia operação — métrica é fire-and-forget.

---

### 2. Alertas automáticos via `notifications`

Edge function `ops-alerts-cron` (rodar a cada 5min):
- **Timeout streak**: ≥3 timeouts consecutivos numa mesma operation nos últimos 15min → notificação `warning`
- **Spotify quota**: ≥5 erros 429 em 10min → notificação `warning`
- **Coleta travada**: songs em `auto_collect_status='queued'` há >15min → notificação
- **Fila congestionada**: candidates do `bot-collect-queue` > 50 → notificação
- **Heartbeat ausente**: nenhum `bot_heartbeats` há >10min → notificação `error`

Dedupe: usa `metadata.kind` + janela de 1h (já existe padrão no projeto).

---

### 3. TTL / rotação de logs (sem perder histórico operacional importante)

Função SQL `cleanup_operational_logs()` SECURITY DEFINER:
- `bot_heartbeats`: manter últimos 7 dias
- `collection_logs`: manter últimos 30 dias
- `bot_events`: manter últimos 30 dias (preserva error/critical por 90 dias)
- `ops_metrics`: manter últimos 30 dias

Agendado via `pg_cron` diariamente (3am). Snapshots, deal logs, fraud alerts e curator data NUNCA são tocados.

---

### 4. Storage / payload growth metrics

View `v_storage_growth`:
- Tamanho total de `curator_deal_snapshots.ai_raw` (jsonb)
- Tamanho total de `bot_print_batches.dom_payload` (jsonb)
- Contagem de prints em `bot-prints` bucket (via storage.objects)
- Crescimento semanal (rolling)

Exposta na página de admin/sistema (read-only).

---

### 5. Documentação de cache & multi-worker (sem implementar)

Criar `docs/SCALE_HOTSPOTS.md` mapeando:
- **RPCs pesadas**: `get_curator_deal_progress` (3 CTEs aninhadas), `get_curator_deal_snapshot_history`, `match_curator_playlist` (fuzzy)
- **Queries críticas**: `bot-collect-queue` candidate select, `register-curator-playlist` existing playlists
- **Race conditions atuais**: importação concorrente (já tem in-memory lock), fila do bot (já marca `queued`), recover de stuck batches
- **Pontos para SKIP LOCKED futuro**: `bot-collect-queue` quando rodar com >1 worker
- **Pontos para advisory locks futuro**: `record_curator_deal_capture` por `(deal_id, song_id)`
- **Cache candidates**: `get_curator_deal_progress` por deal (TTL 60s), Spotify playlist meta (já tem retry; futuro: KV cache)

Pure docs, zero código novo.

---

### 6. UI mínima — painel "Sistema"

Adicionar tab/seção em página admin existente (Sistema/Health) mostrando:
- Últimas 24h de métricas agrupadas por operation: count, p50/p95 duração, error rate
- Últimas alertas operacionais
- Storage growth (view)

Sem dashboards complexos — só leitura crua, suficiente pra debug.

---

### Arquivos

**Migration:**
- nova migration: `ops_metrics` + RLS + indexes, `cleanup_operational_logs()` function, view `v_storage_growth`, agendamento via `pg_cron`

**Edge functions:**
- `_shared/ops-metrics.ts` (helper)
- `ops-alerts-cron/index.ts` (novo)
- chamadas a `recordMetric()` nos hot-paths existentes (não muda lógica)

**Frontend:**
- página admin `Sistema` (ou existente) — seção "Métricas operacionais"

**Docs:**
- `docs/SCALE_HOTSPOTS.md`

---

### Garantias

1. Tracking, snapshots, whitelist, cálculo: **intocados**
2. Métricas são fire-and-forget — nunca bloqueiam request
3. Cleanup roda fora de horário de pico
4. Cache e multi-worker apenas mapeados (zero ativação)
5. Sistema continua se comportando exatamente igual operacionalmente

Aguardando aprovação.