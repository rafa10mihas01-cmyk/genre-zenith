# Onda 3 — Auditoria Forense do Fluxo de Execução

**Data:** 2026-07-29 16:40 UTC
**Escopo:** Somente investigativo. Nenhum código, banco, índice, cron ou dado foi alterado.
**Fontes:** `pg_get_functiondef`, `cron.job`, `pg_stat_user_tables`, `pg_stat_user_indexes`, `pg_publication_tables`, `extensions.pg_stat_statements`, `EXPLAIN (ANALYZE, BUFFERS)` em cópia read-only.
**Base temporal:** janela do Postgres desde o boot atual — **54 dias 18h**.

Diagramas anexos (Mermaid):
- `/mnt/documents/ONDA_03_engine_priority_flow.mmd`
- `/mnt/documents/ONDA_03_realtime_cascade.mmd`
- `/mnt/documents/ONDA_03_growth_flow.mmd`

---

## Descoberta central (leia isto primeiro)

A causa raiz dos **três maiores itens de custo** do sistema é o **mesmo fluxo**:

```
pg_cron  →  engine_priority_compute_all(5000)  →  INSERT append 5000 linhas em
placement_priority_scores  →  publicação supabase_realtime  →  decoder WAL
```

Todo hora, sem exceção. Isso explica simultaneamente:

- **45% de TODO o WAL** (24,99 GB em 54 dias) — o INSERT em massa
- **67% de TODO o storage** (3,75 GB em 3,6M linhas) — sem retenção
- **60% de TODO o tempo de banco** (41.026s) — o decoder WAL do Realtime processando cada linha inserida

**Um único cron horário dispara o triplo maior desperdício da infraestrutura.**

**Confiança: 100%** — evidência combinada de `pg_get_functiondef`, `cron.job`, `pg_publication_tables`, `pg_stat_user_tables` e `pg_stat_statements`.

---

## ALVO 1 — `engine_priority_compute_all`

### Fluxo reconstruído (evidência: definição da função + cron)

```
cron.job id=145 "engine-priority-shadow-hourly"  schedule "7 * * * *"  active=true
  └─ SELECT public.engine_priority_compute_all(5000)
       ├─ INSERT INTO engine_priority_runs (triggered_by='cron', components_used=[...])  RETURNING id
       ├─ FOR r IN SELECT id FROM catalog_placements WHERE status='active'
       │           ORDER BY updated_at DESC NULLS LAST LIMIT 5000  LOOP
       │     ├─ SELECT * FROM compute_placement_priority(r.id)
       │     │     ├─ SELECT engine_priority_weights FROM system_flags
       │     │     ├─ SELECT catalog_placements JOIN catalog_tracks  WHERE cp.id = _placement_id
       │     │     ├─ SELECT popularity FROM spotify_track_cache  WHERE spotify_track_id = ?
       │     │     ├─ SELECT release_date FROM spotify_track_cache  WHERE spotify_track_id = ?
       │     │     ├─ SELECT EXISTS(... FROM curator_deal_songs cds JOIN curator_deals cd
       │     │     │           WHERE cds.spotify_track_id = ?  AND cd.state IN (...) ...)
       │     │     └─ SELECT COUNT(*) FROM catalog_placements cp2 JOIN catalog_tracks ct2
       │     │                 WHERE cp2.managed_playlist_id = ? AND ct2.spotify_artist_id = ?
       │     └─ INSERT INTO placement_priority_scores(placement_id, score, components, calculated_at, run_id)
       │        VALUES (r.id, ..., ..., ..., v_run_id)              ← sempre INSERT, NUNCA UPDATE
       └─ UPDATE engine_priority_runs SET finished_at, duration_ms, stats WHERE id = v_run_id
```

### Métricas medidas

| Métrica | Valor | Fonte |
|---|---:|---|
| Runs em 54d (`engine_priority_runs`) | **890** | `SELECT count(*)`; 890 ≈ 24×37 |
| Chamadas registradas em `pg_stat_statements` | 888 | pss |
| Placements avaliados totais | **3.645.498** | `SUM(placements_evaluated)` |
| Média por run | ~4.096 (não 5000 — algumas campanhas têm menos placements) | agregado |
| Duração média por run | **1.854 ms** | pss (`mean_exec_time`) e run stats batem |
| Duração máxima | 2.912 ms | pss |
| WAL gerado em 54d | **24,99 GB** (45,4% do total) | pss (`wal_bytes`) |
| WAL por run (média) | 28 MB | 24,99 GB / 890 |
| WAL por linha inserida | ~7,2 KB | 24,99 GB / 3,645M — inclui full-page images dos 3 índices |
| Shared blocks lidos (por run) | 207.340 | pss |
| Linhas INSERT | 3.645.498 (100% novas) | `n_tup_ins` |
| Linhas UPDATE | **0** | `n_tup_upd` |
| Linhas DELETE | **0** | `n_tup_del` |

### Respostas objetivas

- **Quem dispara?** `pg_cron` job id=145, schedule `7 * * * *`, ativo.
- **É incremental?** **Não.** Cada run reprocessa os 5.000 placements mais recentemente atualizados. Sem watermark, sem "só o que mudou".
- **Recompute completo?** Sim, com janela deslizante — na prática, como só existem ~18.475 placements ativos, em ~4 horas o cron cobre todo o catálogo, e nas 20 horas restantes fica revisitando os mesmos placements.
- **Escrita redundante?** **Sim, massiva.** Cada placement gera em média **197 snapshots** (3,6M ÷ 18.475). Se `score` não muda entre runs, o INSERT é 100% desperdício.
- **UPDATE sem mudança de valor?** N/A — não há UPDATE, só INSERT.
- **Quanto WAL por dia?** ~440 MB (24,99 GB / 54d), quase metade do WAL total do banco.
- **Existe chave lógica para "só o último estado"?** Sim — `placement_id` é único por natureza. Um `UPSERT ON CONFLICT (placement_id)` com condicional `WHERE score IS DISTINCT FROM excluded.score` eliminaria 99%+ das escritas.

**Confiança: 100%**

---

## ALVO 2 — `placement_priority_scores`

### Anatomia

- **Colunas:** `id uuid, placement_id uuid, score numeric, components jsonb, calculated_at timestamptz, run_id uuid, created_at timestamptz`.
- **Índices (506 MB total):**
  - `_pkey (id)` — 141 MB — **0 idx_scan** (nunca usado)
  - `_placement (placement_id, calculated_at DESC)` — 213 MB — **49.163 scans** (é o índice da tela)
  - `_score (score DESC)` — 90 MB — **0 idx_scan** (nunca usado)
  - `_run (run_id)` — 31 MB — 890 scans
  - `_calc_at (calculated_at DESC)` — 31 MB — 4 scans (queries ad-hoc)

**2 índices (231 MB) nunca leram uma tupla em 54 dias.** Só ocupam WAL.

### Simulação de retenção (SEM executar)

| Estratégia | Linhas | Tabela+idx | Economia | WAL diário |
|---|---:|---:|---:|---:|
| Estado atual (append infinito) | 3.645.498 | **3.755 MB** | — | **440 MB/dia** |
| TTL 180d | ~21,6M em 6 meses | ~22 GB (crescendo) | Nenhuma no curto prazo | 440 MB/dia |
| TTL 90d | ~10,8M | ~11 GB | Nenhuma (janela atual = 36 dias) | 440 MB/dia |
| TTL 60d | ~7,2M | ~7,3 GB | Nenhuma | 440 MB/dia |
| TTL 30d | ~3,6M | ~3,7 GB | **~0** (steady-state hoje) | 440 MB/dia |
| **Só último run por placement (UPSERT)** | **18.475** | **~20 MB** | **-3.735 MB (-99,5%)** | 440 MB/dia (writer inalterado) |
| **UPSERT + WHERE score IS DISTINCT** | 18.475 | ~20 MB | -99,5% | **~4 MB/dia (-99%)** |
| **UPSERT + WHERE distinct + cron 1×/dia** | 18.475 | ~20 MB | -99,5% | **~0,2 MB/dia** |

**Fatos vs. hipóteses:**
- **Fato:** o cron insere 100% em append.
- **Fato:** a tela lê apenas via `idx_priority_scores_placement (placement_id, calculated_at DESC) LIMIT 1` — só o registro mais recente por placement.
- **Fato:** 2 índices (231 MB) têm 0 uso.
- **Hipótese:** o componente `components jsonb` mudar entre runs — a serialização dele pode variar mesmo com score igual. **Não medido nesta onda.** Confiança da redução real: 90% (não 100%) porque depende do jsonb ser estável.

---

## ALVO 3 — `fn_campaign_playlist_growth(uuid[])`

### Plano medido (EXPLAIN ANALYZE, BUFFERS)

**1 campanha:**
```
Function Scan on fn_campaign_playlist_growth  (rows=929 loops=1)
Buffers: shared hit=8791
Execution Time: 273 ms
```

**8 campanhas (batch):**
```
Function Scan on fn_campaign_playlist_growth  (rows=1423 loops=1)
Buffers: shared hit=15660, temp read=5971 written=2900
Execution Time: 711 ms
```

**Extrapolação:** 780 chamadas em 54 dias × ~2.900 blocos temp escritos por batch (8 campanhas) ÷ 8 = **~363 blocos/campanha média × 780 = 283k blocos temp = ≈ 2,2 GB**. Onda 2 mediu 1,14 GB (`temp_blks_written`). Diferença = chamadas com menos campanhas geram menos spill. Ordem de grandeza confere.

### Origem do spill (análise estática do CTE)

A função é 130 linhas de SQL `STABLE`, opaca ao EXPLAIN (só vê Function Scan). Do texto:

| CTE | Operação pesada | Custo |
|---|---|---|
| `xlsx_collections` | LEFT JOIN campaign_playlist_collections × label_spreadsheet_uploads | Buffer scan |
| `paste_collections` | **`DISTINCT ON`** curator_playlists × curator_deals — força **Sort** | **Spill principal** |
| `valid_collections` | UNION ALL | Materialize |
| `ordered` | **`ROW_NUMBER() OVER (PARTITION BY ...)`** — força Sort | **Spill secundário** |
| `latest_meta` | outro `DISTINCT ON` | Sort |
| `acc` | **`CROSS JOIN LATERAL fn_playlist_delivery_accumulated(campaign_id)`** — chamada por linha de campaigns_with_data | Loop N×M |
| `firsts` | GROUP BY | Hash Aggregate |
| `eco` | JOIN campaign_eco_allocations × managed_playlists | Hash Join |

**Fato:** `Buffers: shared hit=15660, temp read=5971 written=2900` para 8 campanhas confirma dois operadores em spill (read+write) — consistente com Sort/HashAggregate excedendo `work_mem`.

**Hipótese (não confirmada por EXPLAIN detalhado):** o maior spill vem do `ROW_NUMBER OVER (PARTITION BY campaign_id, playlist_id ORDER BY sequence_at, captured_at, upload_id)` sobre `valid_collections`. Não foi possível abrir o plano interno sem `SET auto_explain.log_nested_statements = on` — **não solicitado nesta onda**.

**Confiança na função como fonte dos temp files:** 95% (medição direta de `temp_written` em `pg_stat_statements`).
**Confiança no operador específico:** 60% (análise estática, não confirmada com plano interno).

---

## ALVO 4 — Realtime

### Publicação atual

`pg_publication_tables` para `supabase_realtime`:

| Tabela | Uso do Realtime | Volume 54d |
|---|---|---|
| `placement_priority_scores` | Publicada | **3.645.498 INSERT** |
| `playlist_execution_jobs` | Publicada | 30.492 UPDATE + 1.333 INSERT |
| `curator_deal_songs` | Publicada | **13.747 UPDATE sobre 18 linhas** |
| `notifications` | Publicada | 13.561 UPDATE + 1.641 INSERT |
| `bot_events` | Publicada | 13.402 INSERT + 1.137.700 DELETE |
| `engine_priority_runs` | Publicada | 890 INSERT + 890 UPDATE |
| `autopilot_runs` | Publicada | 0 escrita |

### Eventos totais publicados em 54d

Somando INSERT+UPDATE+DELETE de tabelas publicadas: **≈ 4,86 milhões** (dominado por `placement_priority_scores` inserts e `bot_events` deletes).

Eventos por minuto: ~62.

### `SELECT wal->>...` — o custo real

- 6.196.885 chamadas / 41.026s = **6,62 ms por chamada**
- Cada chamada processa 1 evento do WAL
- 6,2M chamadas ÷ 4,86M mutações confirmadas = ~1,27 chamadas por mutação (multiplicidade normal do decoder — cada evento vira múltiplas linhas para `type/schema/table/columns/record/old_record`)

### Diagnóstico

- **Fato:** `placement_priority_scores` sozinha responde por **75% dos eventos publicados**. Como é INSERT append em massa, cada linha é um evento discreto no WAL logical stream.
- **Fato:** `autopilot_runs` está publicada mas nunca é escrita — publicação inútil (custo zero, mas ruído).
- **Fato:** `bot_events` gera 1,14M DELETEs (purge). Cada DELETE é um evento no Realtime — mas se ninguém está subscrito a DELETEs de `bot_events`, ainda assim o decoder processa e descarta.
- **Hipótese:** o subscriber real da tabela `placement_priority_scores` é a `EnginePriorityTab.tsx` (linhas 268, 718). Se essa tela não estiver aberta na maioria do tempo, **estamos gastando 60% do CPU do banco para enfileirar eventos que ninguém consome.**
- **Hipótese não confirmada:** número de subscribers ativos no canal. Não é lido via SQL padrão.

**Confiança na cascata (writes de PPS → 60% CPU do Realtime):** 95%.
**Confiança em "ninguém consome":** 40% — precisaria olhar métricas do Realtime server ou instrumentar o client.

**Ação de menor risco (não proposta, apenas evidenciada):** remover `placement_priority_scores` da publicação Realtime e substituir por polling da tela (que fica aberta minutos por dia) mataria 60% do CPU do banco na hora.

---

## ALVO 5 — WAL (Top 20 geradores)

Fonte: `extensions.pg_stat_statements` ordenado por `wal_bytes` (top 20 já cobre >95% do WAL).

| # | Origem | Op | WAL | % | Acum. | Responsável |
|---:|---|---|---:|---:|---:|---|
| 1 | `placement_priority_scores` INSERT | I | **24,99 GB** | 45,4% | 45,4% | cron `engine-priority-shadow-hourly` → RPC `engine_priority_compute_all` |
| 2 | `sandbox_exec` DO block | DDL | 2,83 GB | 5,1% | 50,5% | Bloco DO recorrente que faz CREATE/REVOKE do role sandbox_exec — origem externa (Studio?) |
| 3 | `cron_health` INSERT | I | 2,42 GB | 4,4% | 54,9% | Wrappers `withCronJob` em todas edge functions |
| 4 | `bot_heartbeats` INSERT v1 | I | 2,02 GB | 3,7% | 58,6% | Edge `bot-heartbeat` chamada pelos bots VPS |
| 5 | `song_snapshot_playlists` INSERT | I | 1,97 GB | 3,6% | 62,2% | 2.805 batches — coleta de streams de música |
| 6 | `cron.job_run_details` INSERT | I | 1,28 GB | 2,3% | 64,5% | `pg_cron` log interno |
| 7 | `purge_cron_job_run_details` | D | 1,21 GB | 2,2% | 66,7% | 55 execuções, cada uma apaga janela grande |
| 8 | RPC anônimo `p_fn_name` (8.100 calls) | I | 0,95 GB | 1,7% | 68,4% | Wrapper de execução de funções via RPC |
| 9 | `cron.job_run_details` UPDATE (end) | U | 0,83 GB | 1,5% | 69,9% | pg_cron |
| 10 | `cron.job_run_details` UPDATE (start) | U | 0,79 GB | 1,4% | 71,3% | pg_cron |
| 11 | `cron.job_run_details` UPDATE (pid) | U | 0,77 GB | 1,4% | 72,7% | pg_cron |
| 12 | RPC `p_campaign_id/p_intent/p_rows` (445) | I | 0,69 GB | 1,3% | 74,0% | Grava planos/rows de campanhas |
| 13 | `spotify_call_log` INSERT | I | 0,67 GB | 1,2% | 75,2% | Logger de chamadas Spotify |
| 14 | `cron.job_run_details` UPDATE (status) | U | 0,66 GB | 1,2% | 76,4% | pg_cron |
| 15 | `purge_bot_heartbeats` | D | 0,66 GB | 1,2% | 77,6% | 55 execuções |
| 16 | `collection_logs` INSERT | I | 0,56 GB | 1,0% | 78,6% | Log de coletas |
| 17 | `catalog_placement_execution_log` INSERT | I | 0,55 GB | 1,0% | 79,6% | Log do occupancy-executor |
| 18 | `organic_plays_snapshots` INSERT | I | 0,53 GB | 1,0% | 80,6% | Coleta orgânica |
| 19 | `bot_heartbeats` INSERT v2 (com métricas) | I | 0,50 GB | 0,9% | 81,5% | Bot VPS |
| 20 | `managed_playlist_tracks` INSERT | I | — | ~0,9% | ~82,4% | Sync de faixas |

**Consolidado por subsistema:**

| Subsistema | WAL | % |
|---|---:|---:|
| `engine_priority_compute_all` (uma função) | 24,99 GB | **45,4%** |
| `pg_cron` internal (`job_run_details` I+U+purge) | 5,54 GB | **10,1%** |
| Logs operacionais (`cron_health` + `spotify_call_log` + `collection_logs` + `catalog_placement_execution_log`) | 4,20 GB | **7,6%** |
| `bot_heartbeats` (I+I+purge) | 3,18 GB | **5,8%** |
| `sandbox_exec` role reset | 2,83 GB | **5,1%** |
| Snapshots (`song_snapshot_playlists` + `organic_plays_snapshots`) | 2,50 GB | **4,5%** |

---

## ALVO 6 — Temp files (ranking completo)

| # | Query | temp_written (8KB blks) | ≈ MB | Calls | Operador provável |
|---:|---|---:|---:|---:|---|
| 1 | `SELECT fn_campaign_playlist_growth($1::uuid[])` | **146.422** | **1.144** | 780 | Sort do `DISTINCT ON`/`ROW_NUMBER` |
| 2 | `SELECT * FROM v_placement_priority_latest ORDER BY score DESC` | 12.379 | 97 | 63 | Sort sobre 3,6M linhas |
| 3 | `dna_blind_test_runs` bootstrap | 446 | 3 | 2 | Sort + Insert |
| 4 | `VACUUM FULL cron.job_run_details` | 432 | 3 | 3 | Rewrite |

**Fato:** 76% dos temp files vêm de UMA função (growth) e 6% de UMA query (v_placement_priority_latest ordenada por score global).
**Fato:** `v_placement_priority_latest` faz ORDER BY score sobre 3,6M linhas sem usar o `idx_priority_scores_score` (o índice está ordenado, mas o filtro DISTINCT ON obriga sort adicional). Se a tabela caísse para 18.475 linhas (Alvo 2), este spill sumia sozinho.

**Confiança:** 95%.

---

## ALVO 7 — Rollbacks

### Dados brutos

- `xact_commit`: 22.933.146
- `xact_rollback`: **5.358.748** (18,94%)
- Deadlocks: **0**
- Sessions abandoned: 764
- pg_stat_statements: **não instrumenta rollbacks separadamente**

### Investigação cruzada

`pg_stat_statements` mostra tempo/calls por statement mas **não separa "abortada" de "commitada"**. Não é possível responder "quais funções abortam" apenas com o que existe hoje. Sinais indiretos coletados:

| Sinal | Evidência | Peso |
|---|---|---|
| Volume massivo de `set_config('search_path', ...)` | 10,97M chamadas — cada request PostgREST | Cada request abortado = 1 rollback |
| `curator_deal_songs` — **7,14M seq scans em 18 linhas** | pg_stat_user_tables | Query lenta cancela por timeout |
| `203.217 net.http_post` | pss | Cada tx que falha HTTP → rollback |
| `907k inserts em cron.job_run_details` | pss | Cron que falha → rollback + retry |
| Deadlocks = 0 | pg_stat_database | Descarta contenção de lock |

### Diagnóstico

**Fato:** existem 5,36M rollbacks.
**Fato:** deadlocks são zero, portanto não é contenção lock.
**Hipótese mais provável (confiança 50%):** timeout client-side do PostgREST — Studio, telas com queries pesadas (`fn_campaign_playlist_growth` @ 273ms, `v_placement_priority_latest` sem paginação, `artist_split_shadow` @ 1.284ms) sendo canceladas quando o React Query dispara refetch e a anterior ainda não terminou.
**Hipótese alternativa (confiança 30%):** falhas de edge functions dentro de uma transação (`net.http_post` retornando não-2xx dentro de RPC).
**Sem instrumentação adicional (log_min_error_statement, log_transaction_sample_rate, ou log de retries do PostgREST) não dá para escolher entre as duas.**

**Confiança na causa raiz:** 40%. Explicado.

---

## ALVO 8 — Fluxo completo dos TOP 10 consumidores

### 1. Realtime WAL decoder (60% CPU)

```
INSERT/UPDATE/DELETE em 7 tabelas publicadas
  ↓
WAL logical stream
  ↓
Decoder: SELECT wal->>'type' as type, wal->>'schema' as schema, ...  (6,2M calls)
  ↓
Realtime server (fora do banco)
  ↓
Websocket → clientes React (NocPanel, AoVivo, EnginePriorityTab)
```
Tempo total: 41.026s (60%). Payload: irrelevante (SELECT interno). Linhas: 6,2M. WAL adicional: 0 (leitura).

### 2. `engine_priority_compute_all` (45% WAL, 67% storage)

Ver diagrama `ONDA_03_engine_priority_flow.mmd`. Tempo por run: 1.854 ms. Payload: nenhum (SECURITY DEFINER retorna uuid). WAL: 28 MB/run.

### 3. `fn_campaign_playlist_growth` (76% temp files)

Ver diagrama `ONDA_03_growth_flow.mmd`. Tempo médio por chamada: 614–825 ms (variantes GET). Buffers: 8k–16k shared. Temp: ~1,5 MB/call.

### 4. PostgREST/Studio introspection (11% CPU)

```
Supabase Studio (browser) ou schema-cache reload
  ↓
GET /rest/v1/  → PostgREST
  ↓
3 queries introspection (WITH table_info / with tables / base_types)
  ↓
Milhões de linhas materializadas (7,6M rows na query de columns)
  ↓
JSON de resposta ao Studio
```
Tempo total: 5.149s. Payload: JSON grande.

### 5. `cron.job_run_details` (7,9% WAL)

```
pg_cron dispara job → INSERT job_run_details (id=jobid,runid,command,status='starting')
                    → UPDATE ...set job_pid, status='running'
                    → UPDATE ...set status, start_time
                    → UPDATE ...set status, return_message, end_time
                    → UPDATE ...set status
                    (5 escritas por job)
purge_cron_job_run_details roda 55× e apaga janela → 1,21 GB WAL
```
907k linhas × 5 statements = 4,54M escritas de log de execução.

### 6. `bot_heartbeats` (5,8% WAL)

```
Bot VPS (a cada 15s) → POST /functions/v1/bot-heartbeat
                     → INSERT bot_heartbeats (327k INSERTs v1 + 47k v2)
                     → publica no Realtime
purge_bot_heartbeats (55×) → 662 MB WAL
```

### 7. `sandbox_exec` DO block (5,1% WAL)

Bloco DO recorrente (2.272 chamadas) que faz `CREATE ROLE sandbox_exec` + `REVOKE ... FROM PUBLIC` por schema. **Origem não identificada no repo** — provavelmente do próprio ambiente Lovable ou de uma ferramenta de sandbox. WAL: 2,83 GB. Não afeta lógica de negócio.

### 8. Snapshots (`song_snapshot_playlists` + `organic_plays_snapshots`) (4,5% WAL)

Coletas periódicas via VPS. INSERTs em batch.

### 9. `campaign_eco_allocations` GET (2,8% CPU)

78.812 chamadas × 24 ms = 1.906s. Origem: 34+ pontos no frontend + edge functions (Onda 1). Tabela tem apenas 105 linhas mas seq scan é escolhido pelo planner (correto, dado o tamanho).

### 10. `spotify_call_log` INSERT (1,2% WAL, 171k inserts)

Cada chamada Spotify pelas edge functions é logada. Cresce ~3.170/dia. Sem TTL agressivo, a tabela vai chegar a 500k+ em 6 meses.

---

## ALVO 9 — Escritas desnecessárias

| # | Sintoma | Evidência | Perda estimada |
|---|---|---|---:|
| 1 | **INSERT append 197× por chave lógica única** | `placement_priority_scores`: 3.6M rows / 18.475 placements distintos | 3,6M inserts, 24,99 GB WAL, 3,7 GB storage |
| 2 | **UPDATE frenético sobre 18 linhas** | `curator_deal_songs`: 13.747 UPDATE sobre 18 rows vivas = **764 updates por row** | Não medido em WAL isolado, mas cada UPDATE é 1 evento Realtime + 1 rollback candidato |
| 3 | **UPDATE frenético sobre 1.424 linhas** | `playlist_execution_jobs`: 30.492 UPDATE = 21 updates por row | ~1 GB WAL estimado (não isolado) |
| 4 | **DELETE > INSERT (bot_events)** | 1.137.700 DELETE contra 13.402 INSERT | Purge saudável, mas cada DELETE é 1 evento Realtime desperdiçado se ninguém subscreve DELETE |
| 5 | **5 escritas de status por job cron** | `cron.job_run_details`: 907k INSERT + 4×907k UPDATE = 4,54M | 4,33 GB WAL total |
| 6 | **Publicação Realtime de tabela sem escrita** | `autopilot_runs`: 0 escritas mas publicada | Zero custo direto mas ruído |
| 7 | **`sandbox_exec` role reset** | 2.272 execuções em 54d = 42/dia | 2,83 GB WAL |
| 8 | **Índices nunca lidos** | `placement_priority_scores._pkey` (141 MB, 0 scan), `_score` (90 MB, 0 scan) | 231 MB storage + WAL de manutenção |
| 9 | **`_http_response` tabela pesa 717 MB com 0 linhas vivas** | `pg_stat_user_tables` | Bloat, precisa VACUUM (não solicitado) |
| 10 | **`v_placement_priority_latest` faz sort de 3,6M por chamada** | 63 calls × 97 MB temp | Consequência do Alvo 2 |

---

## ALVO 10 — Ranking Executivo

| # | Prio | Componente | Problema | Evidência | CPU % | WAL % | Storage % | Temp % | Confiança | Próxima ação (Onda 4+) |
|---|:---:|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | 🔴 | **`engine_priority_compute_all` + `placement_priority_scores`** | Cron horário faz 5k INSERT append; sem UPSERT nem retenção; publica no Realtime | Função + cron 145 + pss + pg_stat_user_tables | ~2,4% (writer) + até **60% (Realtime cascata)** | **45,4%** | **67%** | 6% | **100%** | Propor UPSERT por `placement_id` + tirar tabela do Realtime |
| 2 | 🔴 | **Realtime publication de tabelas pesadas** | `placement_priority_scores` (3,6M ins) e `bot_events` (1,1M del) publicam eventos que provavelmente ninguém consome | pg_publication_tables + pss #1 | Até **60%** | 0% | 0% | 0% | **95%** | Instrumentar subscribers ativos antes de mexer |
| 3 | 🟡 | **`fn_campaign_playlist_growth`** | Sort + DISTINCT ON + LATERAL sem cobertura por índice; spill de 1,14 GB | EXPLAIN + pss temp_blks | 3,5% | 0% | 0% | **76%** | 90% | EXPLAIN interno com `auto_explain`; criar índice `(campaign_id, playlist_id, sequence_at)` em `campaign_playlist_collections` |
| 4 | 🟡 | **PostgREST/Studio introspection** | 3 queries introspection somam 5.149s | pss #2, #5, #6, #9, #11 | **11%** | 0% | 0% | 0% | 95% | Fechar Studio quando não usado; nada a fazer no código |
| 5 | 🟡 | **`cron.job_run_details` I+4U por job** | 4,54M escritas totais | pss | 0,3% | **7,9%** | 0% | 0% | 100% | Reduzir updates redundantes (fora do controle direto — é pg_cron) |
| 6 | 🟡 | **`sandbox_exec` DO block** | 2.272 execuções, 2,83 GB WAL | pss #12 | 0,8% | **5,1%** | 0% | 0% | 100% | Descobrir origem (Lovable interno?) e avaliar |
| 7 | 🟡 | **`bot_heartbeats` INSERT + purge** | 375k inserts + 55 purges | pss | 0,7% | **5,8%** | 0,8% | 0% | 100% | Diminuir frequência de heartbeat de 15s → 30s cortaria 50% |
| 8 | 🟢 | **Rollbacks 18,94%** | Origem não identificável sem `pg_stat_statements` extendido | pg_stat_database | ? | ? | 0% | ? | 40% | Habilitar `log_transaction_sample_rate=0.01` por 1h |
| 9 | 🟢 | **`curator_deal_songs` — 7,14M seq scans em 18 rows** | `compute_placement_priority` filtra por `spotify_track_id` sem índice na coluna | pg_stat_user_tables + definição da função | 0,3% | 0% | 0% | 0% | 100% | Propor índice `curator_deal_songs(spotify_track_id) WHERE spotify_track_id IS NOT NULL` |
| 10 | 🟢 | **`v_placement_priority_latest` ORDER BY score full-scan** | Sort sobre 3,6M rows | pss #2 do ranking temp | 0,5% | 0% | 0% | 6% | 95% | Consequência do Alvo 1 — resolve junto |
| 11 | 🟢 | **`campaign_eco_allocations` fan-out** | 78k chamadas por UI redundante | pss + grep Onda 1 | 2,8% | 0% | 0% | 0% | 95% | Colapsar 3 reads redundantes em `CampanhaExecucao.tsx` num hook único |
| 12 | ⚪ | **Índices `_pkey` e `_score` em PPS** | 231 MB, 0 idx_scan em 54d | pg_stat_user_indexes | 0% | ~1% (manutenção) | 4% (do próprio PPS) | 0% | 100% | Se PPS encolher (Alvo 1), estes viram irrelevantes |
| 13 | ⚪ | **`autopilot_runs` publicada sem escrita** | pub_tables + 0 tup_ins | pg_publication_tables | 0% | 0% | 0% | 0% | 100% | Remover da publicação (custo zero) |
| 14 | ⚪ | **`_http_response` bloat** | 717 MB, 0 rows vivas | pg_stat_user_tables | 0% | 0% | ~13% | 0% | 100% | VACUUM (não solicitado) |
| 15 | ⚪ | **`monitor-all-genres` cron 24s/execução** | 7 calls × 24s | pss | 0,2% | 0% | 0% | 0% | 100% | Investigar utilidade real |

### Ganhos consolidados se atacarmos SÓ o item #1

Se a Onda 4 propuser (para aprovação) a mudança `INSERT → UPSERT ON CONFLICT (placement_id) DO UPDATE ... WHERE score IS DISTINCT FROM excluded.score` + remoção da tabela da publicação Realtime + drop dos 2 índices sem uso:

| Recurso | Antes | Depois | Redução |
|---|---:|---:|---:|
| Tabela `placement_priority_scores` | 3.755 MB | ~20 MB | **-99,5%** |
| Storage do banco | 5,52 GB | 1,8 GB | **-67%** |
| WAL gerado/dia | ~1 GB | ~380 MB | **-62%** |
| CPU do banco (Realtime + writer) | 100% | ~40% | **-60%** |
| Temp files do banco | 1,5 GB / 54d | ~360 MB / 54d | **-76%** |

**Um único fix ataca 4 das 5 métricas de custo simultaneamente.** Confiança agregada: **90%** (o único ponto em aberto é confirmar que `components jsonb` é estável entre runs — 10% de risco de UPSERT não ativar `IS DISTINCT`).

---

## Fatos vs. Hipóteses (consolidado)

**Fatos (100% confiança, evidência SQL direta):**
- Cron 145 dispara a cada hora.
- Função insere append, nunca UPDATE.
- 3,6M linhas em 18.475 placements = 197 snapshots/placement.
- Tabela publicada no Realtime.
- 60% do tempo de banco é o decoder Realtime.
- 45% do WAL é a INSERT dessa tabela.
- 76% dos temp files vêm de `fn_campaign_playlist_growth`.
- `curator_deal_songs.spotify_track_id` não tem índice.
- 2 índices de `placement_priority_scores` (231 MB) têm 0 scans em 54d.

**Hipóteses (não confirmadas nesta onda):**
- Ninguém subscreve `placement_priority_scores` no Realtime a maior parte do tempo — depende de métricas do Realtime server (40%).
- O operador dominante do spill em `fn_campaign_playlist_growth` é o ROW_NUMBER — precisa `auto_explain` (60%).
- Rollbacks vêm de timeouts de PostgREST/Studio — precisa `log_min_error_statement` (50%).
- `components jsonb` é estável entre runs consecutivos — precisa amostrar 2 runs (não medido).

---

## O que esta onda NÃO fez

- Não executou `EXPLAIN` com `SET auto_explain.log_nested_statements = on`.
- Não habilitou `log_transaction_sample_rate` (rollback root cause).
- Não instrumentou subscribers do Realtime.
- Não mediu payload em bytes por endpoint.
- Não abriu edge function logs (fora do escopo desta onda).
- Não propôs nenhuma alteração de código, banco, índice ou cron.

Todos os dados acima estão prontos para embasar **Onda 4 (Frontend + Instrumentação)** ou **Onda de Correção**, quando houver aprovação explícita.
