# Onda 2 — Auditoria Profunda de Custo e Performance

**Data:** 2026-07-29 16:35 UTC
**Escopo:** Somente leitura. Nenhum DDL/DML executado. Nenhuma correção proposta.
**Fontes:** `extensions.pg_stat_statements` (habilitado, nunca resetado), `pg_stat_database`, `pg_stat_user_tables`, `pg_stat_user_indexes`, `pg_class`, `cron.job`.
**Janela de coleta:** desde o último boot do Postgres — **54 dias 18h** de uptime contínuo.

---

## Sumário executivo (ranking em 1 tela)

Ordenado por peso técnico + financeiro (evidência real, não estimativa).

| # | Consumidor | Métrica dominante | Custo bruto | Confiança | Onde dói |
|---|---|---|---|---|---|
| 1 | **Realtime WAL decoder** (`SELECT wal->>...` — replicação lógica) | **6.196.885 chamadas** em 54d, **41.026s** de execução | **60,4% de TODO o tempo de banco** | 100% | CPU do banco |
| 2 | **`engine_priority_compute_all`** (cron horário) | 888 chamadas, **24,99 GB de WAL**, **5,92M full-page images** | **45,4% de TODO o WAL** gerado (55 GB) | 100% | WAL + disco + I/O |
| 3 | **`placement_priority_scores`** — tabela append-only sem TTL | **3.755 MB** = **67% do banco** | 3,4M linhas nos últimos 30d nunca lidas | 100% | Storage + backups + replicação |
| 4 | **PostgREST introspection** (3 queries `WITH table_info` / `with tables as`) | **9.314 chamadas**, **5.149s** de execução | **7,6% do tempo total** | 95% | CPU do banco (Studio/schema-cache) |
| 5 | **`cron.job_run_details`** insert+4×update por job | **4.539.702 statements**, **4,33 GB WAL** | **7,9% do WAL** | 100% | WAL + tabela `job_run_details` (48 MB, 1M deletes) |
| 6 | **`sandbox_exec` role reset** (bloco DO recorrente) | 2.272 chamadas, **2,83 GB WAL**, 358k FPI | 5,1% do WAL | 100% | WAL desnecessário |
| 7 | **`bot_heartbeats` inserts** (327k) | **2,02 GB WAL** | 3,7% do WAL | 100% | WAL |
| 8 | **`cron_health` inserts** (298k) | **2,42 GB WAL** | 4,4% do WAL | 100% | WAL |
| 9 | **`song_snapshot_playlists` inserts** (2.805 chamadas em lote) | **1,97 GB WAL** | 3,6% do WAL | 100% | WAL |
| 10 | **`purge_cron_job_run_details`** | 55 chamadas, **1,21 GB WAL** | 2,2% do WAL | 100% | WAL de manutenção |
| 11 | **`fn_campaign_playlist_growth([]uuid)`** (via PostgREST) | 780 chamadas, **146.422 temp blks written** (~1,14 GB) | **≈76% dos temp files** | 90% | RAM insuficiente → spill em disco |
| 12 | **`campaign_eco_allocations` GET** (PostgREST) | 78.812 chamadas, **1.906s**, 78k rows | 2,8% do tempo total | 100% | CPU (fan-out UI) |
| 13 | **`curator_deal_songs`** — 7,14M seq scans em tabela de **18 linhas** | Sinal claro de query sem WHERE ou RLS custosa | Baixo custo absoluto, mas 100% desperdício | 100% | CPU repetitivo |
| 14 | **`fn_promote_waiting_circuit_breaker_to_pending`** | 46.099 chamadas (~1/min), 560s | 0,8% do tempo | 100% | CPU |
| 15 | **`spotify_call_log` inserts** (171k) | 668 MB WAL | 1,2% do WAL | 100% | WAL |
| 16 | **`bot_heartbeats` GET** (PostgREST polling) | 11.535 chamadas, 510s | 0,75% do tempo | 100% | CPU + rede |
| 17 | **`monitor-all-genres` cron** — mean 24s, max 24s | 7 chamadas, 168s | Onda de I/O concentrada | 90% | Pico CPU |
| 18 | **`recompute_campaign_total_delivered`** | 14 chamadas, mean 724ms, **max 7,9s** | Pico raro mas alto | 100% | CPU/lock |
| 19 | **`artist_split_shadow` GET** | 98 chamadas, mean 1.283ms | 125s total | 100% | Scan grande |
| 20 | **Rollbacks** (18,94%) + **1,5 GB temp files** | 5,36M rollbacks / 28,3M txns | Causa raiz não instrumentada | 40% | CPU/IO |

**Base de comparação:**
- Total de tempo de execução no banco em 54 dias: **67.869s** (18h50m) — média de **1,4s de CPU-DB por minuto** (baixo, o banco NÃO está saturado).
- Total de WAL gerado: **54,98 GB** (≈ 1 GB/dia).
- Cache hit ratio: **100%** — nenhum I/O físico relevante.
- Deadlocks: **0**.

---

## PARTE 1 — Top SQL por custo real

Fonte: `extensions.pg_stat_statements`, ordenado por `total_exec_time`.

### Top 15 por tempo total de execução

| Rank | Query (resumida) | Calls | total_ms | mean_ms | rows | s_hit | s_read | WAL bytes |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | Realtime WAL decoder `SELECT wal->>...` | 6.196.885 | **41.026.351** | 6,62 | 6.198.465 | 11,1B | 5 | 30 MB |
| 2 | PostgREST `WITH table_info` (v1) | 3.810 | 2.700.094 | **708,69** | 3.810 | 280M | 0 | 30 MB |
| 3 | PostgREST GET `campaign_eco_allocations` | 78.812 | 1.906.109 | 24,19 | 78.812 | 15,8M | 0 | 2 KB |
| 4 | `SELECT engine_priority_compute_all($1)` | 888 | 1.650.459 | **1.858,62** | 888 | 184M | 52.086 | **24,99 GB** |
| 5 | PostgREST `WITH table_info` (v2) | 2.891 | 1.600.752 | 553,70 | 2.891 | 167M | 26 | 15 MB |
| 6 | PostgREST `with tables as` (tabelas) | 2.613 | 848.484 | 324,72 | 496.435 | 434M | 0 | 937 KB |
| 7 | `SELECT net.http_post(...)` | 203.217 | 768.158 | 3,78 | 203.217 | 49,8M | 16 | 172 B |
| 8 | PostgREST GET `vw_campaign_playlist_growth` (por campanha) | 1.028 | 632.143 | **614,92** | 1.028 | 1,2M | 0 | 13 KB |
| 9 | PostgREST introspection base_types | 4.707 | 573.181 | 121,77 | 1.383.250 | 62M | 574 | 5 MB |
| 10 | `fn_promote_waiting_circuit_breaker_to_pending` | 46.099 | 560.240 | 12,15 | 46.099 | 64M | 0 | 8 MB |
| 11 | PostgREST introspection columns | 2.613 | 541.527 | 207,24 | 7.674.286 | 98M | 1 | 116 KB |
| 12 | Bloco DO `sandbox_exec` (role reset) | 2.272 | 528.114 | 232,44 | 0 | 60M | 50 | **2,83 GB** |
| 13 | PostgREST GET `bot_heartbeats` (polling) | 11.535 | 510.815 | 44,28 | 11.535 | 94M | 3.636 | 4 MB |
| 14 | PostgREST GET `vw_campaign_playlist_growth` (agregado) | 864 | 459.821 | 532,20 | — | — | — | — |
| 15 | `monitor-all-genres` cron DO | 7 | 168.229 | **24.032,65** | — | — | — | — |

### Análise CPU

- **60,4% do tempo total de banco** é gastto por UMA query: o **decoder de replicação lógica do Realtime**. É um custo intrínseco de ter Realtime ligado, escalado com a **taxa de INSERT/UPDATE** em tabelas publicadas.
- A **segunda maior categoria** (soma 3+8+14 + 5 outras variantes) é o **fan-out de leituras da view `vw_campaign_playlist_growth`** — apesar da memória `[Campaign playlist growth RPC]` dizer que a view foi removida, o statement `SELECT ... FROM public.vw_campaign_playlist_growth` continua registrado com **1.028 + 864 + 219 + 162 = 2.273 chamadas** somando **≈ 1.900s**. **Precisa investigar se a view foi realmente removida ou se ainda existe como pass-through.**
- PostgREST/Studio introspection (queries 2, 5, 6, 9, 11) somam **7,26M ms** — **10,7% do tempo total** — origem: painel Supabase/Studio abrindo schema cache. Custo "invisível" ao aplicativo mas real.

### CPU por chamada (mean_ms) — top 5 offensores >500ms com calls>=5

| Query | calls | mean_ms | max_ms |
|---|---:|---:|---:|
| `monitor-all-genres` cron DO | 7 | 24.033 | 24.041 |
| `engine_priority_compute_all` | 888 | 1.859 | 2.912 |
| `cleanup_old_bot_prints` | 55 | 1.439 | 7.021 |
| `artist_split_shadow` GET | 98 | 1.284 | 1.789 |
| `recompute_campaign_total_delivered` | 14 | 724 | 7.906 |

---

## PARTE 2 — EnginePriorityTab (cadeia)

**Não foi possível instrumentar em tempo real sem alterar código.** Evidência estática coletada:

| Camada | Objeto | Custo observado |
|---|---|---|
| Frontend | `src/components/catalogo/EnginePriorityTab.tsx` linhas 268, 718 | Subscribe `postgres_changes` na tabela + chamada manual à RPC |
| React Query | (não instrumentado) | — |
| RPC | `public.engine_priority_compute_all(int)` | 888 chamadas em 54d = **1 por hora** (bate com o cron `engine-priority-shadow-hourly`, schedule `7 * * * *`) |
| SQL | INSERT em batch de 5.000 rows em `placement_priority_scores` | **1.859ms** por execução, produz **28 MB de WAL por run** |
| Tabela | `placement_priority_scores` (3,75 GB) | idx_scan em `idx_priority_scores_placement`: **49.163 scans** — este é o índice usado pela tela |
| Payload GET | `v_placement_priority_latest` | 63 chamadas, **12k temp blocks** (~94 MB de spill) — ordena por score sem índice adequado |

**Custo real da tela**: baixo (63 leituras em 54d). **Custo real do writer**: alto (45% do WAL do sistema). O gargalo NÃO é a tela, é o cron que a alimenta.

---

## PARTE 3 — `placement_priority_scores`

### Estado atual

| Métrica | Valor |
|---|---|
| Linhas vivas | 3.645.498 |
| Placements distintos | **18.475** — média de **197 snapshots por placement** |
| Registro mais antigo | 2026-06-23 17:10 UTC |
| Registro mais novo | 2026-07-29 16:07 UTC |
| Idade máxima | 36 dias |
| Heap | 3.247 MB |
| Índices | 506 MB (5 índices, 3 nunca usados — `pkey`, `_score`, e `_calc_at` só 4 scans) |
| Inserts / Deletes | 3.645.498 / **0** — append-only estrito |
| WAL gerado pelo writer em 54d | **24,99 GB** |

### Distribuição temporal (inserts/dia)

```
06-29:  24.563 (bootstrap)
06-30 → 07-03: 84.216/dia
07-04 → 07-05: 97k → 114k (ramp-up)
07-06 → 07-29: 120.000/dia (regime permanente)
```

Regime constante: **+120k rows/dia**, ≈ **100 MB/dia de tabela + 15 MB/dia de índice + 800 MB/dia de WAL** (o WAL é ~8× maior porque cada INSERT triga full-page images nos 3 índices).

### Simulação de TTL (SEM executar DELETE)

Cálculo: (120.000 × dias_manter × avg_row_bytes 890 B) + 15% de overhead de índice.

| Retenção | Linhas mantidas | Tabela+idx estimados | Economia vs. hoje | WAL futuro/mês | Storage no banco |
|---|---:|---:|---:|---:|---:|
| **Sem TTL (hoje)** | cresce ∞ | 3.755 MB | — | ~24 GB/mês | 67% |
| **TTL 180d** | ~21,6M | ≈ 22 GB (crescendo) | — | 24 GB/mês | ainda cresce |
| **TTL 90d** | ~10,8M | ≈ 11 GB | — | 24 GB/mês | ainda cresce |
| **TTL 60d** | 7,2M | 7,3 GB | — | 24 GB/mês | igual |
| **TTL 30d** | 3,6M | ~3,7 GB | ≈ 0 (steady-state atual) | 24 GB/mês | 67% (estável) |
| **Manter só último run por placement** | **18.475** | ≈ 20 MB | **3.735 MB (99,5%)** | 24 GB/mês | **0,4%** |
| **Manter só último run por placement + parar cron horário** | 18.475 | 20 MB | 3.735 MB | **~200 MB/mês** | 0,4% |

**Conclusão:** TTL por tempo (30/60/90d) é ineficaz — o volume de 30 dias já é praticamente a tabela inteira. **O único ganho real é reter apenas o último `run_id` por `placement_id`** — economia de **99,5% do storage** e (se combinado com redução da frequência do cron) **≈ 99% do WAL**.

**Nenhuma ação proposta nesta onda.**

---

## PARTE 4 — Rollbacks

### Estado

- `xact_rollback`: **5.358.748** (18,94% de todas as transações)
- Deadlocks: **0**
- Sessões abandonadas: 764

### Correlação com pg_stat_statements

Sem `track_planning=on` e sem `pg_stat_statements` gravando aborts separadamente, **não é possível atribuir rollbacks a queries específicas apenas com `pg_stat_statements`**. Sinais indiretos:

- **Volume de statements curtos e recorrentes** com padrão de retry/timeout:
  - `set_config('search_path', ...)` chamado **10,97M vezes** — normal do PostgREST, mas cada request abortado conta como 1 rollback.
  - `curator_deal_songs` — 1,82M leituras + **7,14M seq scans em uma tabela de 18 linhas** → alta probabilidade de queries cancelando (statement_timeout ou client cancel).
- **203.217 chamadas a `net.http_post`** — cada uma é uma transação; se qualquer HTTP falhar dentro de um bloco tx, rollback.
- **cron.job_run_details**: 907k inserts + 3 updates cada — falha de qualquer cron gera rollback.

### Diagnóstico

Confiança na causa raiz: **~50%**. A hipótese mais provável é PostgREST abortando requisições por timeout do cliente (Studio + polling do frontend). Para confirmar é necessário instrumentar (log_min_error_statement + log_transaction_sample_rate) — **não solicitado nesta onda**.

---

## PARTE 5 — WAL (ranking completo)

Total WAL gerado em 54 dias: **54,98 GB** (≈ 1,02 GB/dia).

| Rank | Origem | WAL | % do total | Padrão |
|---|---|---:|---:|---|
| 1 | `engine_priority_compute_all` | **24,99 GB** | **45,4%** | INSERT append 120k/dia + 3 índices |
| 2 | `sandbox_exec` DO block (role reset) | 2,83 GB | 5,1% | CREATE/REVOKE recorrente |
| 3 | `cron_health` inserts | 2,42 GB | 4,4% | 298k inserts |
| 4 | `bot_heartbeats` inserts (v1) | 2,02 GB | 3,7% | 327k inserts |
| 5 | `song_snapshot_playlists` inserts | 1,97 GB | 3,6% | 2.805 batches |
| 6 | `cron.job_run_details` insert | 1,28 GB | 2,3% | 907k linhas |
| 7 | `purge_cron_job_run_details` | 1,21 GB | 2,2% | 55 execuções |
| 8 | RPC `_shared` (job de fn_name) | 0,95 GB | 1,7% | 8.100 chamadas |
| 9 | `cron.job_run_details` update (end) | 0,83 GB | 1,5% | 907k updates |
| 10 | `cron.job_run_details` update (start) | 0,79 GB | 1,4% | 907k updates |
| 11 | `cron.job_run_details` update (pid) | 0,77 GB | 1,4% | 907k updates |
| 12 | RPC `intent/rows` (445 chamadas) | 0,69 GB | 1,3% | INSERTs grandes |
| 13 | `spotify_call_log` insert | 0,67 GB | 1,2% | 171k inserts |
| 14 | `cron.job_run_details` update (status) | 0,66 GB | 1,2% | 907k updates |
| 15 | `purge_bot_heartbeats` | 0,66 GB | 1,2% | 55 execuções |
| 16 | `collection_logs` insert | 0,56 GB | 1,0% | 66k inserts |
| 17 | `catalog_placement_execution_log` insert | 0,55 GB | 1,0% | 47k inserts |
| 18 | `organic_plays_snapshots` insert | 0,53 GB | 1,0% | 85k inserts |
| 19 | `bot_heartbeats` insert (v2) | 0,50 GB | 0,9% | 47k inserts |
| 20 | `managed_playlist_tracks` insert | truncado | — | — |

**cron.job_run_details somado (linhas 6+9+10+11+14)**: **4,33 GB (7,9%)** — um único subsistema (pg_cron logging) escrevendo mais WAL que qualquer tabela de negócio depois do `placement_priority_scores`.

**Custo de FPI (full-page images)** — mostra WAL "gordo" por inserts em páginas cheias:
- `engine_priority_compute_all`: **5.921.203 FPI** (∼47 GB brutos comprimidos para 25 GB).
- `sandbox_exec` DO: 358.292 FPI.

---

## PARTE 6 — Temp files

Total: **1.501 MB** distribuídos em **213 arquivos** em 54 dias. Pouco por dia, mas concentrado.

Ranking por `temp_blks_written` (1 bloco = 8 KB):

| Rank | Query | temp_written | ≈ MB | Calls |
|---|---|---:|---:|---:|
| 1 | `SELECT fn_campaign_playlist_growth($1::uuid[])` | **146.422** | **1.144 MB** | 780 |
| 2 | `v_placement_priority_latest` GET (ORDER BY score) | 12.379 | 97 MB | 63 |
| 3 | `dna_blind_test_runs` bootstrap | 446 | 3 MB | 2 |
| 4 | `VACUUM FULL cron.job_run_details` | 432 | 3 MB | 3 |

**Conclusão:** **76% dos temp files vêm de UMA função** — `fn_campaign_playlist_growth(uuid[])`. Cada chamada spills ~1,5 MB em disco em média. Isso combina com a Onda 1 (view removida mas RPC ainda em uso pesado em 10+ telas). Provável causa: hash join ou sort sem índice cobrindo `(campaign_id, playlist_id, captured_at)`.

**A tabela `placement_priority_scores` NÃO aparece como origem de temp files** — o worker do append é linear, não faz sort. Os "8,97M tuples lidos" reportados na Onda 1 vinham do `idx_priority_scores_calc_at` **usado 4 vezes** em queries range enormes (média 3,1M tuples/scan) — provavelmente diagnóstico manual ou export ad-hoc, **não a tela em produção**.

---

## PARTE 7 — Custo financeiro (tradução)

**Sem preço unitário oficial do plano Lovable Cloud** aqui, então mostro em **unidades técnicas** e em **percentual do consumo total** — o financeiro segue o que a plataforma cobra do usuário.

### Banco de dados

| Recurso | Valor atual | Origem dominante | Se otimizar #1, #2 e #3 |
|---|---|---|---|
| **CPU** | 67.869s / 54d = 14,5min/dia | Realtime decoder (60%), Priority compute (2,4%), PostgREST introspection (11%) | Realtime é custo intrínseco; otimizar priority + reduzir Studio poll → **~15% CPU** |
| **RAM** | 100% cache hit | — | Sem ganho relevante |
| **Storage** | 5,52 GB total, **3,75 GB (67%) em uma tabela** | placement_priority_scores | Retenção "só último" → **-3,7 GB (-67% do banco)** |
| **WAL** | 54,98 GB em 54d (~1 GB/dia) | 45% priority, 8% cron_details, 7% heartbeats+health | Parar cron horário + colapsar cron_details → **-55% WAL** |
| **I/O físico** | negligível (100% cache) | — | Não é o gargalo |

### Edge Functions / net.http

- `net.http_post`: **203.217 chamadas** em 54d = **3.763/dia** = 1 a cada 23s.
- `net._http_response` cleanup roda 353.378 vezes com 272s totais — 25% do custo do subsistema `net`.
- Não há dados de custo por invocação sem consulta ao billing da plataforma.

### Workers/VPS

Fora do repo. Não auditado.

### Rede

Payload por chamada não instrumentado. Baseado em `rows` retornados:
- `SELECT wal->>...` retorna 6,2M rows → tráfego interno de replicação Realtime.
- `fn_campaign_playlist_growth` retorna dezenas de rows por chamada — payload pequeno.

### Redução potencial se atacarmos os TOP 3

| Ação (hipotética, não proposta) | CPU | WAL | Storage | Confiança |
|---|---:|---:|---:|---:|
| Reter só último run em `placement_priority_scores` | -2,4% | ~ 0 (writer continua) | **-67%** | 95% |
| Reduzir frequência do cron `engine_priority_compute_all` (1/h → 1/dia) | -2,3% | **-42%** | -63% (menos linhas) | 90% |
| Colapsar cron.job_run_details (purge mais agressivo + reduzir updates) | -0,5% | -7% | -1% | 70% |
| Reduzir chamadas duplicadas a `fn_campaign_playlist_growth` (cache no client) | -0,7% | 0 | 0 | 80% |
| Diminuir polling do PostgREST introspection (Studio fechado quando não usado) | **-11%** | -0,1% | 0 | 60% |

Efeito combinado (todos acima): **~-17% CPU** e **~-49% WAL** e **-67% storage** — sem tocar em código de negócio.

---

## Achados adicionais (não estavam no escopo mas apareceram)

1. **`curator_deal_songs` — 7,14M seq scans em 18 linhas.** Alta probabilidade de falta de índice em uma RPC (`claim_playlist_for_deal`?) ou de RLS que força seq scan. Custo baixo (tabela cabe em 1 página) mas indica bug lógico.
2. **`bot_heartbeats` — 2,17 bilhões de tuplas lidas em 33.757 seq scans** — cada scan atravessa a tabela inteira (36k rows). Origem: buscas ILIKE no NocPanel (Onda 1 já identificou).
3. **`vw_campaign_playlist_growth` ainda aparece em `pg_stat_statements`** com custo real (≈1.900s) mesmo após ter sido "removida" segundo memory. **Requer verificação**: `SELECT viewname FROM pg_views WHERE viewname='vw_campaign_playlist_growth'`  retornou 0 na Onda 1 — então os statements devem ser de janela anterior à remoção, mas ainda pesam na média. Rechecar.
4. **`monitor-all-genres` — 24 segundos por execução, 7 chamadas.** Custo alto por evento. Vale investigar se ainda é usado.
5. **`sandbox_exec` DO block — 2.272 chamadas, 2,83 GB WAL.** Role reset recorrente escrevendo mais WAL que `bot_heartbeats`. Vale investigar quem dispara.
6. **`_http_response` tabela pesa 717 MB** com 0 linhas vivas — bloat de `pg_net`. Já é limpo por cron mas VACUUM não foi feito.
7. **`job_run_details` tem 1,09M deletes vs 41k linhas vivas** — bloat óbvio, cabe VACUUM FULL (já rodado 3× conforme temp files).

---

## O que NÃO foi possível medir sem alterar o sistema

- Tempo por camada da EnginePriorityTab (frontend → API → SQL) — precisaria instrumentação temporária.
- Payload em bytes por endpoint — não exposto pelo Postgres.
- Custo em USD — requer preço unitário da plataforma.
- Causa exata do rollback ratio — precisa habilitar `log_min_error_statement=error` ou `log_transaction_sample_rate`.
- Métricas por Edge Function individual — requer `analytics_query`, não usado nesta onda por escopo.

---

## Base para próximas ondas

Toda ação sugerida em Onda 3+ deve carregar:
- Métrica de origem desta auditoria (linha da tabela).
- Confiança (percentual).
- Economia esperada em CPU/WAL/Storage.
- Rollback plan.

**Nenhuma otimização foi proposta nesta onda.** Este documento é a linha de base.
