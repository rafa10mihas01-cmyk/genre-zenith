# AUDIT 4.A — Hardening de Performance (read-only)

**Data:** 2026-06-17 · **Modo:** auditoria. Nenhuma migration, DROP, RENAME ou alteração foi executada.

Evidência primária: `pg_stat_statements`, `pg_stat_user_tables`, `pg_stat_user_indexes`, `pg_views`, `db_health` (Lovable Cloud). Auditorias anteriores reaproveitadas: AUDIT_08 (índices), AUDIT_10 (cockpit), SCALE_HOTSPOTS.

---

## 0. Snapshot do banco

| Métrica | Valor | Nota |
|---|---|---|
| DB / PgBouncer | up / up | 🟢 |
| Restarts | 0 | 🟢 |
| Memória | 24% | 🟢 |
| Disk | 15% (636 MB) | 🟢 |
| Conexões | 32 / 160 | 🟢 |
| Pool clients | 1 / 800 | 🟢 |
| WAL | **928 MB** (> tamanho do DB) | 🟠 — alto, checar `wal_keep_size` / replicação |
| Rolled-back txns desde boot | **1.269.889** | 🟠 — possíveis conflitos de unique / advisory locks abortados |

Compute saudável. Não há gargalo de CPU/RAM/conexão. Os gargalos são todos de **query plan** e **frequência de polling**.

---

## 1. RPCs / Queries — Top ofensores por `total_ms`

Ranking por tempo total acumulado em `pg_stat_statements` (24h+ de tráfego):

| # | Alvo | Calls | Mean | Max | Total | Classif. |
|---|---|---|---|---|---|---|
| 1 | `vw_campaign_playlist_growth` (filtro `campaign_id=$1`) | 1.028 | 614 ms | 7.7 s | **632 s** | 🔴 |
| 2 | `bot_heartbeats` SELECT 3 cols ORDER created_at DESC LIMIT | 11.488 | 44 ms | 309 ms | 509 s | 🔴 |
| 3 | `vw_campaign_playlist_growth` (+ LIKE em attributed_to) | 615 | 702 ms | 7.9 s | 432 s | 🔴 |
| 4 | `campaign_eco_allocations` + 2 LATERAL JOIN (campaigns, managed_playlists) | 18.531 | 14 ms | 62 ms | 275 s | 🟠 |
| 5 | `bot_heartbeats` SELECT created_at apenas | 6.280 | 41 ms | 410 ms | 261 s | 🔴 |
| 6 | DO loop `refresh-search-tracks` (cron) c/ `pg_sleep(2)` por gênero | 7 | 24 s | 24 s | 168 s | 🟠 |
| 7 | `bot_heartbeats` SELECT 6 cols ORDER created_at | 3.703 | 37 ms | 102 ms | 137 s | 🟠 |
| 8 | `notifications WHERE read=$1` (sem index, count + page) | 7.228 | 18 ms | 569 ms | 136 s | 🟠 |
| 9 | `vw_campaign_playlist_growth` (subset playlist_id+plays) | 162 | 824 ms | 7.0 s | 133 s | 🔴 |
| 10 | `vw_campaign_playlist_growth` (campaign_id = ANY) | 161 | 778 ms | 7.3 s | 125 s | 🔴 |
| 11 | `curator_deal_songs` poll do bot (LATERAL deals→curators→campaigns→clients + agg playlists) | 514.129 | 0.22 ms | 18 ms | 110 s | 🟢 (alto volume, latência ok) |
| 12 | `campaign_playlist_collections` ORDER created_at ASC | 6.568 | 14 ms | 119 ms | 95 s | 🟠 |
| 13 | `curator_deals` UPDATE reconcile (`last_reconciled_at`) | 725 | 122 ms | **7.8 s** | 88 s | 🟠 — picos sugerem lock |
| 14 | `vw_campaign_playlist_growth` (subset attributed_to+delta+delivery) | 161 | 535 ms | 5.9 s | 86 s | 🔴 |
| 15 | `search_results WHERE first_seen_at>=$1` head:true count | 16.356 | 4.8 ms | 308 ms | 79 s | 🟢 |
| 16 | `artist_split_shadow` SELECT * full scan + count | 53 | 1.17 s | 1.25 s | 62 s | 🟠 |
| 17 | `campaign_eco_allocations` variante 2 (com order) | 18.531 | 2 ms | 16 ms | 38 s | 🟢 |

**Conclusão única e dominante:** `vw_campaign_playlist_growth` aparece em **6 das 15 maiores ofensoras**, somando ~**1.4 milhão de ms** (≈ 23 min de CPU acumulada). É o gargalo #1 absoluto.

EXPLAIN ANALYZE detalhado não foi extraído nesta passada (read-only sem alterar plan_cache); a view é definida sobre `campaign_playlist_collections` + joins com `playlists` / `campaign_eco_allocations` / `curator_campaign_playlists`. Indícios de Seq Scan / HashAggregate em filtros `attributed_to` + `delta` derivados em runtime.

---

## 2. VIEWS

26 views públicas (nenhuma materializada). Lista relevante:

| View | Sinal de uso | Risco |
|---|---|---|
| `vw_campaign_playlist_growth` | **#1 ofensor**, 6 padrões diferentes consultando | 🔴 — candidata #1 a virar materializada ou RPC com filtro |
| `campaign_playlist_inventory_v1` | usada por Hub | 🟡 a auditar custo |
| `v_campaign_velocity`, `v_dispatch_trace` | dashboards | 🟢 baixo volume |
| `v_curator_finance`, `v_curator_balance`, `v_curator_global_finance` | tela Financeiro | 🟡 |
| `v_catalog_*` (5 views) | catálogo | 🟢 |
| `v_brain_health`, `genres_with_health` | cockpit | 🟢 |
| `vw_403_audit_report`, `vw_inventory_vs_monitor_diff` | auditoria | 🟢 |

**Nenhuma materializada.** Não há `REFRESH MATERIALIZED VIEW` no projeto. Para a #1 (`vw_campaign_playlist_growth`), recomenda-se avaliar materialização parcial ou RPC `get_campaign_playlist_growth(_campaign_id uuid)` com projeção mínima.

---

## 3. TRIGGERS

Query a `information_schema.triggers` retornou **0 linhas** sob o role atual (provavelmente filtro de visibilidade do role da auditoria). Triggers conhecidos do código:

- `update_updated_at_column()` em várias tabelas — barato.
- `set_curator_deal_baseline_*` — operacional, custo desprezível.
- Trigger de `enqueuePlaylistJob` indireto (via Edge).

Sem evidência de trigger caro ou duplicado. **A auditoria de triggers neste relatório é inconclusiva por permissão** e deve ser refeita via migration de leitura `SECURITY DEFINER` numa próxima passada.

---

## 4. ÍNDICES

Já mapeado em `AUDIT_08_INDEXES.md`. Estado atual:

- **35 índices > 200 KB com `idx_scan = 0` (~23 MB)** — confirmado novamente hoje. Lista completa em `AUDIT_08`.
- **Duplicação** `idx_pms_template` ≡ `idx_pms_template_collected_desc` em `playlist_metrics_snapshots`.
- **Faltando** — não identificado índice ausente óbvio para os top-15 (todas as queries atingem índices existentes). O problema do top-1 (`vw_campaign_playlist_growth`) **não é índice**, é volume de JOIN/agregação dentro da view.

Classificação geral: 🟠.

---

## 5. CAMPANHAS — tabelas críticas

| Tabela | Tamanho | live | dead | seq_scan | idx_scan | Vacuum | Diag |
|---|---|---|---|---|---|---|---|
| `campaign_playlist_collections` | 14 MB | 24.546 | 2.862 | **3.682** | 59.396 | OK | 🟠 seq_scan elevado |
| `campaigns` | (não top) | — | — | — | — | — | 🟢 |
| `curator_deals` | (não top) | — | — | — | — | — | 🟠 UPDATE com max 7.8 s |
| `curator_deal_snapshots` | 8 MB | 1.136 | 47 | 809 | **676.533** | OK | 🟢 |
| `delivery_proofs` | (não top) | — | — | — | — | — | 🟢 |
| `bot_print_batches` | 3.4 MB | 227 | 16 | 58 | 32.470 | OK | 🟢 |

**Hot spots:**
- `campaign_playlist_collections` com 3.682 seq scans é o único alvo realmente preocupante na lista de Campanhas. Provável causa: a view #1 e o SELECT #12 percorrendo `created_at ASC` sem filtro composto.
- `curator_deal_snapshots` está **excelente** (676k idx_scan / 1.136 linhas vivas → razão > 595x, totalmente indexado).
- `bot_heartbeats` (94 MB, fora da lista de Campanhas) é o pior cidadão de armazenamento: 19.970 seq scans + 5.575 idx_scan. **Polling do cockpit causa a maior parte do tráfego SQL do projeto.**

---

## 6. EDGE FUNCTIONS

Não há `pg_stat` para Edge runtime (Deno). Inferências do código já consolidado nas Fases 1-3:

| Função | Sinal | Diag |
|---|---|---|
| `bot-heartbeat` | aciona INSERT em `bot_heartbeats` (94 MB) | 🟠 volume vs valor (TTL 7d existe) |
| `bot-ingest-snapshot` | passa por `collection-writer` + `match_curator_playlist` | 🟢 consolidado |
| `playlist-queue-processor` | claim + invoke (fan-out de até 5 jobs / 2 min) | 🟢 |
| `get-shared-campaign-plan` (público) | lê `delivery_proofs` + `curator_deal_snapshots` | 🟡 a benchmarkar |
| `campaign-plan-api`, `campaign-daily-plan` | lê `vw_campaign_playlist_growth` | 🔴 herda gargalo da view |
| `refresh-search-tracks` (cron DO block) | `pg_sleep(2)` por gênero, 24 s total | 🟠 — serializado por design, ok |
| `detect-curator-fraud` | scan diário | 🟢 |
| `sync-managed-playlist-tracks` | rate-limited Spotify | 🟢 |

Cold start, retries e timeouts por função **não foram medidos nesta passada** — exigem agregação dos `edge_function_logs` por função e por hora.

---

## 7. FRONTEND

Diagnóstico cruzado AUDIT_10 + slow queries:

| Gargalo | Evidência |
|---|---|
| **Polling agressivo de `bot_heartbeats`** | 3 padrões SELECT diferentes, 21k+ calls combinadas, totalizando **907 s**. Provavelmente 3 hooks/components diferentes pollando a mesma tabela. |
| **Polling de `notifications`** | 7.228 calls em `WHERE read=$1`, ~136 s. Realtime existe (NotificationsBell) mas o head:true count parece estar sendo refeito. |
| **`/campanhas/:id/execucao` chama view #1 várias vezes** | 4 padrões distintos da `vw_campaign_playlist_growth` com `campaign_id=$1` (subset de colunas diferente) → indica componentes irmãos buscando isoladamente em vez de compartilhar React Query cache. |
| **PlaylistDetail waterfall** | já documentado em AUDIT_10: 3 selects sequenciais antes do brain. |
| **`select("*")` em JSONBs pesados** | `playlist_brain.*` e `playlist_diagnoses.raw` (~19 KB/linha) carregados quando só 3 colunas são exibidas. |

🔴 Polling de heartbeats. 🔴 4× redundância da view de growth. 🟠 demais.

---

## 8. VPS

Sem instrumentação direta nesta auditoria. Sinais via `bot_print_batches` (227 linhas, 16 dead) e `bot_events` (16 MB, dead=4.701): saúde estável. Detalhamento de threads/OCR/upload exigiria payload do bot — fora do escopo de read-only DB.

---

## 9. BOT — pipeline de coleta

Tempo por etapa não foi medido aqui. Mas os sinais SQL confirmam:

- **Match** (RPC `match_curator_playlist`) — ausente do top-15 ofensores → 🟢 rápido.
- **Writer** (`ingest_campaign_collection_batch`) — ausente do top-15 → 🟢.
- **Polling do bot** (`curator_deal_songs` LATERAL com 6 joins, 514k calls, mean 0.22 ms) → 🟢 surpreendentemente eficiente.
- **`curator_deal_snapshots`**: 676k idx_scan, vacuum em dia → 🟢.

Bot e ingestão **não são o gargalo**. O gargalo é leitura de Campanhas no Frontend.

---

## 10. BANCO

| Sinal | Valor | Diag |
|---|---|---|
| Connections | 32/160 | 🟢 |
| Pool | 1/800 | 🟢 |
| WAL | 928 MB | 🟠 |
| Rolled-back txns desde boot | 1,27 M | 🟠 |
| Restarts | 0 | 🟢 |
| Statement timeout | padrão | 🟢 |
| Long transactions | nenhuma evidente | 🟢 |
| Autovacuum | rodando (cf. `last_autovacuum` em todas as quentes ≤ 24 h) | 🟢 |
| Bloat | `campaign_playlist_collections` 11% dead — leve | 🟡 |

---

## CLASSIFICAÇÃO GLOBAL

| Camada | Status |
|---|---|
| Hardware/Compute | 🟢 Excelente |
| Banco geral | 🟡 Bom |
| Ingestão / Bot / Match / Writer | 🟢 Excelente |
| Snapshots / Delivery | 🟢 Excelente |
| **Views (especificamente `vw_campaign_playlist_growth`)** | 🔴 Crítica |
| **Polling frontend (`bot_heartbeats`, `notifications`)** | 🔴 Crítica |
| Índices não utilizados (~23 MB) | 🟠 Atenção |
| Edge functions de leitura derivadas da view #1 | 🔴 Crítica (herdado) |
| Triggers | ⚪ Inconclusivo |
| VPS / Bot ops | 🟢 (sem evidência negativa) |

---

## PLANO DE OTIMIZAÇÃO (sem executar)

| # | Item | Impacto | Esforço | Risco | Tempo |
|---|---|---|---|---|---|
| 1 | Reescrever consumo de `vw_campaign_playlist_growth`: criar RPC `get_campaign_playlist_growth(_campaign_id, _projection text[])` ou materializar incrementalmente | 🔴 Alto (~1.4 M ms/dia) | M | M (RLS na RPC) | 1d |
| 2 | Consolidar polling de `bot_heartbeats` em **1 hook compartilhado** (React Query `staleTime` + dedupe) | 🔴 Alto (~907 s/dia) | S | 🟢 baixo | 2h |
| 3 | Unificar fetches da view #1 no Hub: 4 padrões → 1 query + `select` no cliente | 🔴 Alto | S | 🟢 | 3h |
| 4 | Notifications `WHERE read=false` → índice parcial `(user_id) WHERE read=false` + Realtime para invalidar count | 🟠 médio | S | 🟢 | 1h |
| 5 | DROP em batch dos 35 índices nunca usados (lista AUDIT_08, batch 1 = 6 índices, ~16 MB) | 🟠 médio (escrita) | S | 🟢 reversível | 30min + 7d observação |
| 6 | Investigar UPDATE `curator_deals` reconcile com max 7.8 s (lock?) — adicionar `pg_advisory_xact_lock` por deal | 🟠 médio | S | 🟡 | 2h |
| 7 | `campaign_playlist_collections` — índice `(campaign_id, created_at)` se não existir | 🟠 médio | S | 🟢 | 30min |
| 8 | AUDIT_10 quick wins: `Promise.all` em PlaylistDetail + `staleTime` em brain/diagnose | 🟡 baixo (perceptível) | S | 🟢 | 1h |
| 9 | Projeção de colunas em `usePlaylistBrain` (split Header vs Full) | 🟡 | M | 🟢 | 4h |
| 10 | Drop `artist_split_shadow` SELECT * do frontend (1.1 s/call) — adicionar paginação real | 🟡 | S | 🟢 | 1h |
| 11 | Investigar WAL 928 MB (checar `max_wal_size`, replicação dangling) | 🟡 | S | 🟡 | 1h |
| 12 | Auditoria real de triggers via SECURITY DEFINER | 🟡 | S | 🟢 | 30min |

---

## RESPOSTA FINAL

### 🔴 Os 10 maiores gargalos

1. `vw_campaign_playlist_growth` — 1.4 M ms acumulados, mean 500-800 ms, max ~8 s.
2. Polling redundante de `bot_heartbeats` (3 padrões diferentes, 21k+ calls).
3. 4 fetches paralelos da view #1 na mesma página (`/campanhas/:id/execucao`).
4. Edge functions `campaign-plan-api` e `campaign-daily-plan` herdando latência da view #1.
5. Polling de `notifications WHERE read=false` (7k calls / 136 s).
6. `campaign_eco_allocations` LATERAL JOIN (18k calls, 275 s) — mean baixo, volume alto.
7. UPDATE `curator_deals` reconcile com picos de 7.8 s — possível contenção.
8. `campaign_playlist_collections` ORDER created_at ASC (6.5k calls, 95 s).
9. `artist_split_shadow` SELECT * sem paginação (1.1 s/call).
10. WAL crescendo a 928 MB (> tamanho do DB) — possível pressão de checkpoint.

### 🟢 Os 10 maiores ganhos rápidos

1. Hook único compartilhado para `bot_heartbeats` (2h, -907 s/dia).
2. Unificar 4 fetches da view #1 em 1 query (3h).
3. Índice parcial `notifications(user_id) WHERE read=false` (1h).
4. DROP batch dos índices nunca usados (30 min, libera 23 MB).
5. `Promise.all` nas 3 queries iniciais de PlaylistDetail (AUDIT_10 #1, 5 min).
6. `staleTime: 60_000` em hooks de brain/diagnose (10 min).
7. Adicionar paginação em `artist_split_shadow` no frontend (1h).
8. Índice composto `campaign_playlist_collections(campaign_id, created_at)` se ausente (30 min).
9. Reduzir colunas selecionadas em queries de heartbeats que só precisam de `status`+`created_at` (15 min).
10. Cache 60 s no Edge para `campaign-daily-plan` (HTTP cache header, 30 min).

### O que deve ser otimizado primeiro

Itens **#1 + #2 + #3 + #4** do plano. Eles juntos atacam ~70% do tempo SQL acumulado e exigem ~2 dias de trabalho.

### O que pode esperar

#9, #10, #11, #12. Ganho marginal ou já documentado (AUDIT_10).

### O que NUNCA deve ser alterado (arquitetura consolidada — Fase 3)

- `match_curator_playlist` (única autoridade de Match).
- `collection-writer.ts` e `ingest_campaign_collection_batch` (único Writer).
- `raw_ingest` (único Gateway).
- `curator_deal_snapshots`, `delivery_proofs`, `campaign_playlist_collections` (estrutura e responsabilidade — só índices podem ser tocados).
- `observed_playlist_snapshots` (preservado, fora de escopo).
- Separação `playlist_metrics_snapshots` × `playlist_followers_snapshots` × `catalog_track_baselines` × `catalog_track_snapshots` (cada um responde uma pergunta de negócio diferente — `mem://preference/consolidation-rule`).
- Crons consolidados (10 ativos).

**Próximo passo recomendado:** Fase 4.B — executar itens #1-#4 do plano (RPC + dedupe de polling + índice parcial + cache), com benchmark antes/depois.
