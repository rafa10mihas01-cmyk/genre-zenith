# ONDA 04 — Simulação de Otimização (ZERO RISCO)

**Data:** 2026-07-31
**Modo:** 100% read-only. Nenhum DDL, DML, migration, índice ou cron foi alterado.
**Métodos usados:** `EXPLAIN (ANALYZE, BUFFERS)`, `pg_stat_user_tables`, `pg_stat_user_indexes`, `pg_publication_tables`, amostragem `TABLESAMPLE`, contagem de cardinalidade real e projeção linear.
**Único comando de sessão usado:** `SET work_mem` (escopo de sessão, sem efeito em produção).

> Regra aplicada: nenhuma recomendação sem simulação quantitativa que a justifique. Onde a evidência contradisse uma hipótese das Ondas 1–3, a hipótese foi **derrubada** (ver Cenário 6).

---

## Baseline medido (fatos, não estimativas)

### `placement_priority_scores`

| Métrica | Valor medido |
|---|---|
| Linhas | 3.860.498 |
| Heap | 3.351 MB |
| Índices | 541 MB |
| **Total** | **3.894 MB** |
| Linha média (heap) | 903 B (dos quais 805 B = `components` jsonb) |
| Placements distintos | 18.475 |
| Placements ativos no catálogo | 19.084 |
| Linhas últimas 24h | 120.000 |
| Janela de dados | 2026-06-23 → 2026-07-31 (**38 dias**) |
| `n_tup_upd` / `n_tup_del` | **0 / 0** (append puro) |
| Índices na tabela | 5 (pkey 148 MB, placement 230 MB, calc_at 33 MB, run 33 MB, score 97 MB) |
| Publicada no Realtime | **Sim** |

Derivados: **102,5 MB/dia** de crescimento total, **~37,4 GB/ano**, **~209 snapshots por placement** em 38 dias.

### Cron `engine_priority_compute_all`

| Métrica | Valor medido (7 dias) |
|---|---|
| Execuções/dia | 24 (de hora em hora) |
| Duração média | 2.619 ms (máx 2.900 ms) |
| Placements avaliados/run | 5.000 (limite fixo) |
| Cobertura por run | 5.000 / 19.084 = **26,2%** |
| INSERTs/dia | 120.000 |

### Volatilidade real do score (chave da simulação)

```
janela: últimos 3 dias | 360.000 linhas comparadas com lag()
mudaram de valor:  266.095  →  73,92%
repetidas (lixo):   93.905  →  26,08%
```

**Conclusão-chave:** 26% das linhas são cópia idêntica da anterior (desperdício puro), mas **74% mudam** — então a economia de um UPSERT **não vem de evitar escrita, vem de evitar acumular histórico**: 1 linha viva por placement em vez de 209.

---

## CENÁRIO 1 — `placement_priority_scores`: 5 modelos de retenção

Base de cálculo: 903 B/linha heap, índices = 16,1% do total (541/3.894 medido), 120k linhas/dia, 18.475 placements.

| Modelo | Linhas em regime | Heap | Índices | **Total** | WAL/dia | Custo escrita | Custo leitura | Cron | Crescimento anual | Economia vs A |
|---|---|---|---|---|---|---|---|---|---|---|
| **A — histórico infinito (atual)** | 3,86 M hoje → 43,8 M em 1 ano | 3.351 MB → 38 GB | 541 MB → 6,1 GB | **3.894 MB → 44 GB** | ~658 MB | 120k INSERT + 600k entradas de índice | Index scan OK hoje, degrada com bloat | 2,6 s | **+37,4 GB** | — |
| **B — último por placement (UPSERT)** | **18.475** (fixo) | **16,3 MB** | 2,6 MB | **~19 MB** | ~87 MB (só as 74% que mudam, HOT update) | 88,7k UPDATE + 31,3k no-op | Leitura sempre 1 linha/placement, sem `DISTINCT ON` | ~2,4 s (-8%) | **~0 GB** | **-99,5% storage / -87% WAL** |
| **C — TTL 30 dias** | 3,60 M | 3.126 MB | 505 MB | **3.631 MB** | ~658 MB (inalterado) | igual a A + custo do DELETE (120k/dia) | igual a A | 2,6 s + job de purga | **0 GB (teto)** | -6,8% storage, **0% WAL** |
| **D — TTL 90 dias** | 10,8 M | 9.377 MB | 1.514 MB | **10.891 MB** | ~658 MB | igual a A + DELETE | pior que hoje (3x linhas) | 2,6 s | 0 GB (teto alto) | **-180% (PIORA 2,8x)** |
| **E — TTL 180 dias** | 21,6 M | 18,3 GB | 3,0 GB | **21,3 GB** | ~658 MB | igual a A + DELETE | pior ainda | 2,6 s | 0 GB (teto muito alto) | **-447% (PIORA 5,5x)** |

**Leitura crítica:** os modelos D e E são **armadilhas** — hoje a tabela tem só 38 dias de vida, então "TTL 90/180 dias" não corta nada: apenas autoriza a tabela a crescer para 11 GB / 21 GB. Só o modelo **B** resolve. O modelo **C** apenas põe um teto e **não reduz WAL nem Realtime** (a escrita continua igual), além de adicionar 120k DELETEs/dia (que geram WAL e dead tuples adicionais).

**Modelo B+ (recomendado):** UPSERT em `placement_priority_scores` (1 linha por placement, PK/unique em `placement_id`) **+** tabela de auditoria opcional `..._history` gravando **só quando `score IS DISTINCT FROM`** e com TTL 30d → 88,7k linhas/dia × 30 = 2,66 M linhas, mas sem o jsonb `components` (805 B dos 903 B) → ~110 MB em regime. Preserva 100% da rastreabilidade histórica de score a **3% do custo atual**.

---

## CENÁRIO 2 — `engine_priority_compute_all`: 5 modelos de escrita

Nota importante medida: dos 2.619 ms do cron, a esmagadora maioria é o loop `compute_placement_priority()` (5.000 chamadas em PL/pgSQL, uma por vez) — o INSERT é barato por linha. Portanto **os modelos abaixo economizam storage/WAL/Realtime, não CPU do cron**. Quem economiza CPU é o modelo incremental.

| Modelo | Linhas escritas/dia | WAL/dia | CPU (cron) | Tempo/run | Storage em 1 ano | Eventos Realtime/dia |
|---|---|---|---|---|---|---|
| **1. Atual (INSERT append)** | 120.000 | ~658 MB | 100% (2,6 s × 24) | 2.619 ms | 44 GB | 120.000 |
| **2. UPSERT (sempre grava)** | 120.000 UPDATE | ~180 MB (-73%: sem novas entradas em 5 índices, HOT update na maioria) | ~97% | ~2,5 s | **19 MB** | 120.000 |
| **3. UPDATE só quando muda** | **88.700** | **~87 MB (-87%)** | ~95% (31,3k writes evitados) | ~2,4 s | **19 MB** | **88.700 (-26%)** |
| **4. Incremental** (só placements com `updated_at`/sinal alterado desde o último run) | ~20–35k (estimativa: 26% do universo muda por hora em média ponderada) | ~25 MB (-96%) | **-70%** (loop de ~1.200 iterações em vez de 5.000) | **~700 ms** | 19 MB | ~25.000 (-79%) |
| **5. Somente diferenças** (incremental + write-if-changed + `components` fora da linha quente) | ~20k | ~15 MB (-98%) | -72% | ~650 ms | 19 MB + ~110 MB de history enxuto | ~20.000 (-83%) |

**Efeito colateral positivo do modelo 4:** hoje o cron cobre **26,2%** do catálogo por execução (`LIMIT 5000` sobre 19.084 ativos, ordenado por `updated_at DESC`) — placements frios podem passar **4 horas** sem re-score. Um modelo incremental cobre **100% do universo relevante** por hora, com 1/4 do custo. Ou seja: é otimização **e** correção funcional.

**Risco identificado no código atual (read-only, não corrigido):** o `EXCEPTION WHEN OTHERS` dentro do loop engole erros individualmente — cada exceção abre/fecha um subtransaction (XID), o que é candidato direto à **taxa de rollback de 18,9%** medida na Onda 2. Modelo 4 reduz as iterações em ~76% e, por consequência, os subtransactions.

---

## CENÁRIO 3 — `fn_campaign_playlist_growth`

Medição real na campanha com mais playlists (`1f609379…`, 179 linhas de retorno):

```
work_mem = 4 MB (padrão da instância)
  Execution Time: 348,5 ms
  Buffers: shared hit=5236
  temp read=3262 written=2311   ← ~25 MB lidos / ~18 MB escritos em disco

work_mem = 64 MB (mesma query, mesma sessão)
  Execution Time: 325,8 ms
  Buffers: shared hit=5236
  temp: NENHUM
```

Campanha pequena (82 linhas): 13,5 ms, 1.261 buffers, sem temp.

| Otimização simulada | Tempo | Temp files | Buffers | CPU | Observação |
|---|---|---|---|---|---|
| **Atual** | 348 ms | 25 MB read / 18 MB write | 5.236 | 100% | spill de `DISTINCT ON` + `ROW_NUMBER` |
| **`work_mem` maior (64 MB, por função via `SET LOCAL`)** | 326 ms (**-6,4%**) | **0 (-100%)** | 5.236 (0%) | -6% | Explica os 76% de temp files da Onda 2 com **1 linha de código**. Não reduz CPU. |
| **Índice adequado** (`(campaign_id, playlist_id, captured_at DESC)` nas tabelas de snapshot) | est. 180–230 ms (-35%) | 0 | est. 1.800 (-65%) | -35% | Ganho vem de trocar sort por index scan ordenado. Confiança **média** — precisa `hypopg` (não instalado) para confirmar sem criar índice. |
| **Materialized view** (refresh a cada 5 min) | **2–6 ms (-98%)** | 0 | ~50 (-99%) | -98% no read path, custo movido para o refresh (1 execução em vez de N) | Introduz staleness de até 5 min. Conflita com a regra "1 KPI = 1 fonte oficial"? Não — a MV **é** a fonte, alimentada pela função. |
| **Cache (React Query `staleTime` 60 s + dedupe)** | 348 ms na 1ª chamada, 0 ms nas seguintes | -N× | -N× | proporcional ao nº de chamadas evitadas | Onda 1 já apontou leituras redundantes em `CampanhaExecucao.tsx`. Custo zero de backend. |
| **RPC incremental** (só playlists com import novo desde o último cálculo) | est. 30–60 ms (-85%) | 0 | -85% | -85% | Maior esforço; exige coluna de watermark por playlist. |

**Combinação ótima simulada:** `SET LOCAL work_mem` (-100% temp, esforço trivial) + cache no cliente (-N× chamadas) = **~90% do ganho com ~5% do esforço**. MV só se o painel for aberto muitas vezes por minuto.

---

## CENÁRIO 4 — Realtime

Tabelas publicadas em `supabase_realtime` (7): `notifications`, `autopilot_runs`, `curator_deal_songs`, `bot_events`, **`placement_priority_scores`**, `engine_priority_runs`, `playlist_execution_jobs`.

| Modelo | Eventos/dia (PPS) | WAL decodificado | CPU do decoder | Tráfego de saída | Economia |
|---|---|---|---|---|---|
| **Publicação atual** | 120.000 | ~658 MB/dia só de PPS | 60,4% do tempo total de DB (Onda 2) | 120k × ~1 KB ≈ **117 MB/dia** para clientes inscritos | — |
| **Publicar só quando houver alteração** (modelo 3 do Cenário 2) | 88.700 | ~87 MB/dia | est. **-60% do custo do decoder** | 86 MB/dia | -26% eventos, **-87% WAL** |
| **Publicação por lote** (1 evento por run com resumo em `engine_priority_runs`, que já é publicada) | **24/dia** | ~87 MB/dia (WAL da tabela permanece, mas fora da publicação) | est. **-85%** | **~0,1 MB/dia (-99,9%)** | Maior ganho isolado do sistema |
| **Publicação consolidada** (remover PPS e `bot_events` da publicação; UI escuta só `engine_priority_runs`) | 0 de PPS + 0 de bot_events (1,1 M deletes/dia deixam de ser decodificados) | — | est. **-90% do decoder → ~6% do tempo de DB** | ~0 | **Recupera ~54 pontos percentuais de CPU de banco** |

**Pergunta que precisa ser respondida antes de agir:** existe alguma tela assinando `placement_priority_scores` em tempo real? Nenhuma necessidade funcional foi identificada nas Ondas 1–3 — um cron de hora em hora não precisa de streaming por linha. Se confirmado, a **remoção de PPS da publicação é a otimização de maior ROI do sistema inteiro**, com esforço de uma linha.

---

## CENÁRIO 5 — Índices com `idx_scan = 0`

Critério: `idx_scan = 0` desde o último reset de estatísticas, tamanho > 200 KB. Análise item a item (top ofensores):

| Índice | Tam. | Inútil? | Usado por FK? | Usado em UPDATE? | Usado em INSERT? | Usado pelo planner? | Simulação de remoção |
|---|---|---|---|---|---|---|---|
| `placement_priority_scores_pkey` | 148 MB | **Não** | Não (é o alvo, não a origem) | Não (0 updates) | **Sim** — valida unicidade em cada um dos 120k INSERTs/dia | Não escolhido para scan | **NÃO REMOVER** (é constraint). Sob o Modelo B ele encolhe sozinho de 148 MB → 0,7 MB |
| `idx_priority_scores_score` | 97 MB | **Sim** | Não | Não | Sim (manutenção pura, custo sem retorno) | Nunca | **REMOVER: -97 MB + ~15% do custo de INSERT na tabela.** Risco: ordenação por score numa tela futura → recriável em minutos |
| `idx_priority_scores_calc_at` | 33 MB | Quase (5 scans) | Não | Não | Sim | Raramente | Manter por ora; irrelevante sob Modelo B |
| `song_snapshot_playlists_pkey` | 9,2 MB | Não | Não | — | Sim | Não | Constraint — manter |
| `idx_bot_heartbeats_hostname` | 7,6 MB | **Sim** | Não | Não | Sim | Nunca | **REMOVER: -7,6 MB** + INSERT de heartbeat mais leve (tabela de alta frequência) |
| `idx_split_shadow_source` | 4,2 MB | **Sim** (tabela shadow) | Não | Não | Sim | Nunca | REMOVER: -4,2 MB |
| `idx_cron_run_log_name_time` | 4,2 MB | **Não** conclusivo | Não | Não | Sim | Provável em queries do painel de saúde (podem não ter rodado desde o reset) | **Manter** — falso positivo provável |
| `idx_cron_run_log_failures` | 1,3 MB | idem | Não | Não | Sim | idem | Manter |
| `idx_sab_user_created` | 2,0 MB | Sim | Não | Não | Sim | Nunca | REMOVER |
| `idx_snapshot_playlists_url` | 2,3 MB | Sim | Não | Não | Sim | Nunca | REMOVER |
| `idx_bot_ingest_raw_worker` / `_hash` | 2,1 MB | `_hash` provavelmente serve dedupe (unique?) | Não | Não | Sim | `_hash` sim em anti-join | Remover só `_worker` |
| `idx_bot_events_worker` / `_correlation_id` | 1,9 MB | Sim | Não | Não | Sim | Nunca | REMOVER (tabela com 1,1 M deletes/dia — cada índice a menos é ganho direto) |
| Todos os `*_pkey` da lista (audit_log, bot_events, analysis_snapshot_events, …) | ~10 MB | **Não** | — | — | Sim | Não | **NUNCA REMOVER** — `idx_scan = 0` em PK significa "ninguém busca por id", não "inútil": a constraint é verificada em toda escrita |

**Total simulado de remoção segura:** ~117 MB de índice + redução mensurável no custo de INSERT das 4 tabelas mais quentes (PPS, bot_heartbeats, bot_events, bot_ingest_raw). **Ressalva metodológica:** `idx_scan` é cumulativo desde o último `pg_stat_reset()`; índices de painéis raros (ex.: `cron_run_log`) podem ser falsos positivos. Recomendação: `pg_stat_reset()` + 14 dias de observação antes de qualquer DROP.

---

## CENÁRIO 6 — `curator_deal_songs`: hipótese DERRUBADA

A Onda 3 recomendou índice em `spotify_track_id` por causa de **7,36 M seq scans**. A simulação **refuta** a recomendação:

```
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM curator_deal_songs WHERE spotify_track_id = ...

 Seq Scan on curator_deal_songs (actual time=0.020..0.027 rows=1)
   Rows Removed by Filter: 17
   Buffers: shared hit=5
 Execution Time: 0.056 ms
```

| Cenário | Tempo | Buffers | CPU |
|---|---|---|---|
| **Seq Scan (atual)** | **0,056 ms** | 5 (todos em cache) | ~0 |
| **Index Scan (simulado)** | est. 0,05–0,08 ms (**igual ou pior**) | 3–4 no read, **+1 write por INSERT/UPDATE** | ~0 |

A tabela tem **18 linhas** e ocupa **240 kB** — cabe inteira em 2 páginas em shared buffers. O planner **jamais** escolheria um índice aqui, e criá-lo só adicionaria custo de manutenção em escrita.

**Diagnóstico correto:** 7,36 M seq scans / 125,9 M tuplas lidas **não é um problema de índice, é um problema de volume de chamadas** — algo (RLS, um hook do frontend ou uma função em loop) consulta essa tabela milhões de vezes. Custo real: 7,36 M × 0,056 ms ≈ **6,9 minutos de CPU acumulados**, irrelevante. **Ação recomendada: NENHUMA no banco.** Investigar o chamador na Onda 5 (é também uma das 7 tabelas publicadas no Realtime — aí sim pode importar).

---

## CENÁRIO 7 — Impacto financeiro consolidado

Premissas de conversão (faixas conservadoras de infra gerenciada; margem ±30%): storage $0,125/GB/mês · egress $0,09/GB · compute proporcional ao tempo de DB.

| Recurso | Hoje | Após otimizações (Modelos B+3/4 + Realtime consolidado + índices) | Economia |
|---|---|---|---|
| **CPU (tempo de DB)** | Decoder Realtime 60,4% + cron 2,6 s×24 | Decoder ~6% · cron ~0,7 s×24 | **~-55 pontos percentuais de carga** → permite adiar/reverter upgrade de instância |
| **RAM** | Spills em `fn_campaign_playlist_growth`, cache poluído por 3,4 GB de PPS | Working set cai de ~5,5 GB para ~1,7 GB | **-69% de pressão de cache** |
| **Storage** | 5,52 GB (PPS = 3,89 GB = 70%) | ~1,7 GB | **-3,8 GB (-69%)** ≈ $0,48/mês hoje |
| **IO** | 120k INSERT/dia + 600k entradas de índice + spill de 43 MB/consulta | ~25k UPSERT/dia, spill zero | **-80%** |
| **WAL** | ~658 MB/dia = **19,7 GB/mês** | ~87 MB/dia = 2,6 GB/mês (Modelo 3) ou ~25 MB/dia (Modelo 4) | **-87% a -96%** (backup/PITR encolhem na mesma proporção) |
| **Realtime** | 120k eventos/dia de PPS + 1,1 M deletes/dia de bot_events | ~24 eventos/dia | **-99,9% de eventos, ~117 MB/dia de egress evitado** |
| **Edge Functions** | Não é ofensor nesta onda (cron roda em pg_cron, não em edge) | igual | 0 |
| **Rede** | ~117 MB/dia Realtime + payloads de `fn_campaign_playlist_growth` repetidos | ~0,1 MB/dia + cache | **~-3,5 GB/mês** ≈ $0,32/mês |
| **Crescimento anual** | **+37,4 GB/ano só de PPS** (+ WAL 236 GB/ano) | **~0 GB/ano** (tabela de tamanho fixo) | **evita ~$56/ano de storage e o upgrade de instância que ele forçaria em ~6 meses** |

**Leitura honesta do número financeiro:** em valores absolutos hoje a economia direta é modesta (**~$1–2/mês**). O valor real está em **(a)** evitar o upgrade compulsório de instância que 37 GB/ano + 60% de CPU em decoder forçariam dentro de ~6 meses, e **(b)** eliminar a degradação de latência que já se manifesta (spills, bloat, cobertura de cron em 26%). É otimização **de trajetória**, não de fatura corrente.

---

## RELATÓRIO EXECUTIVO — TOP 20 por ROI

| # | Otimização | Ganho técnico | Ganho financeiro | Risco | Esforço | Dependências | Confiança |
|---|---|---|---|---|---|---|---|
| 1 | Remover `placement_priority_scores` da publicação Realtime | -120k eventos/dia; decoder de 60,4% → ~10% do tempo de DB | Evita upgrade de compute (~$25–50/mês) | **Baixo** (se nenhuma UI assina) | 1 linha | Confirmar que nenhum hook assina a tabela | **90%** |
| 2 | `placement_priority_scores` → UPSERT 1 linha/placement (Modelo B) | 3.894 MB → 19 MB (-99,5%); WAL -73% | -$0,49/mês agora, -$56/ano de trajetória | Médio (perde histórico se não houver tabela de auditoria) | Médio | Item 3 | **95%** |
| 3 | Tabela `..._history` enxuta (sem `components`), TTL 30d, grava só se score mudou | Preserva rastreabilidade a 110 MB em vez de 44 GB/ano | idem item 2 | Baixo | Médio | — | 90% |
| 4 | Remover `bot_events` da publicação Realtime | 1,1 M deletes/dia deixam de ser decodificados | Compute | Baixo | 1 linha | Verificar assinantes | 85% |
| 5 | `SET LOCAL work_mem='64MB'` em `fn_campaign_playlist_growth` | temp files -100% (43 MB/chamada → 0); -6% tempo | IO | **Muito baixo** | **1 linha** | — | **99%** (medido) |
| 6 | UPDATE só quando `score IS DISTINCT FROM` | -31,3k escritas/dia (-26%); WAL -87% | WAL/backup | Baixo | Baixo | Item 2 | 95% |
| 7 | Cron incremental (só placements com sinal alterado) | Loop 5.000 → ~1.200; cron 2,6 s → 0,7 s; **cobertura 26% → 100%** | Compute + corrige defeito funcional | Médio | Médio-alto | Definir watermark | 80% |
| 8 | DROP `idx_priority_scores_score` (97 MB, 0 scans) | -97 MB; INSERT ~15% mais leve | Storage | Baixo | Trivial | 14d de observação pós-`pg_stat_reset` | 85% |
| 9 | Cache/dedupe de `fn_campaign_playlist_growth` no frontend | Elimina N-1 chamadas de 348 ms | Compute + rede | Muito baixo | Baixo | `CampanhaExecucao.tsx` (Onda 1) | 90% |
| 10 | Publicação por lote: UI escuta `engine_priority_runs` (24/dia) em vez de PPS | -99,9% de eventos e egress | Rede | Baixo | Baixo | Item 1 | 90% |
| 11 | Índice de cobertura para o `DISTINCT ON` da growth fn | -35% tempo, -65% buffers | Compute | Baixo | Médio | Validar com `hypopg` | **60%** |
| 12 | DROP `idx_bot_heartbeats_hostname` (7,6 MB, 0 scans) | INSERT de heartbeat mais leve | Storage/IO | Baixo | Trivial | Observação 14d | 85% |
| 13 | DROP `idx_bot_events_worker` + `_correlation_id` | -1,9 MB; menos manutenção em tabela com 1,1 M del/dia | IO | Baixo | Trivial | Observação 14d | 80% |
| 14 | Reduzir subtransactions do `EXCEPTION WHEN OTHERS` no loop do cron | Ataca a taxa de rollback de 18,9% | Compute | Médio | Médio | Item 7 | **65%** (correlação, não prova) |
| 15 | DROP `idx_split_shadow_source`, `idx_sab_user_created`, `idx_snapshot_playlists_url`, `idx_bot_ingest_raw_worker` | -12,6 MB | Storage | Baixo | Trivial | Observação 14d | 80% |
| 16 | Materialized view da growth fn (refresh 5 min) | 348 ms → ~4 ms (-98%) | Compute | **Médio** (staleness) | Alto | Só se o painel for hot | 75% |
| 17 | `pg_stat_reset()` + janela de 14 dias antes de qualquer DROP | Elimina falsos positivos de `idx_scan=0` | — | Nenhum | Trivial | Pré-requisito de 8/12/13/15 | 100% |
| 18 | Mover `components` jsonb (805 B de 903 B) para tabela satélite | -89% do heap mesmo sem mudar o modelo | Storage | Médio | Médio | Alternativa ao item 2 | 85% |
| 19 | RPC incremental da growth fn (watermark por playlist) | -85% CPU no painel de campanhas | Compute | Médio | Alto | Item 5 primeiro | 70% |
| 20 | **NÃO** criar índice em `curator_deal_songs.spotify_track_id` | Evita custo de manutenção sem ganho | — | — | — | Derruba recomendação da Onda 3 | **99%** (medido) |

---

## MATRIZ FINAL

| Otimização | CPU | WAL | Storage | Temp Files | Risco | Esforço | ROI | Confiança |
|---|---|---|---|---|---|---|---|---|
| Remover PPS do Realtime | **-50 p.p.** | 0% | 0% | 0% | Baixo | Trivial | ⭐⭐⭐⭐⭐ | 90% |
| PPS → UPSERT (Modelo B) | -3% | **-73%** | **-99,5%** | 0% | Médio | Médio | ⭐⭐⭐⭐⭐ | 95% |
| History enxuta + TTL 30d | 0% | -2% | -97% vs manter histórico | 0% | Baixo | Médio | ⭐⭐⭐⭐ | 90% |
| Remover `bot_events` do Realtime | -8 p.p. | 0% | 0% | 0% | Baixo | Trivial | ⭐⭐⭐⭐⭐ | 85% |
| `work_mem` na growth fn | -6% | 0% | 0% | **-100%** | Muito baixo | Trivial | ⭐⭐⭐⭐⭐ | 99% |
| Write-if-changed | -2% | **-87%** | 0% (com B) | 0% | Baixo | Baixo | ⭐⭐⭐⭐⭐ | 95% |
| Cron incremental | **-70%** | -96% | 0% (com B) | 0% | Médio | Alto | ⭐⭐⭐⭐ | 80% |
| DROP `idx_priority_scores_score` | -1% | -3% | -97 MB | 0% | Baixo | Trivial | ⭐⭐⭐⭐ | 85% |
| Cache da growth no frontend | -N× | 0% | 0% | -N× | Muito baixo | Baixo | ⭐⭐⭐⭐ | 90% |
| Publicação por lote | -5 p.p. | 0% | 0% | 0% | Baixo | Baixo | ⭐⭐⭐⭐ | 90% |
| Índice de cobertura growth | -35% | 0% | +8 MB | -100% | Baixo | Médio | ⭐⭐⭐ | 60% |
| DROPs de índices menores | -1% | -2% | -22 MB | 0% | Baixo | Trivial | ⭐⭐⭐ | 80% |
| MV da growth fn | **-98%** | +pequeno | +20 MB | -100% | Médio | Alto | ⭐⭐⭐ | 75% |
| `components` em satélite | 0% | -60% | -89% heap | 0% | Médio | Médio | ⭐⭐⭐ | 85% |
| TTL 30d sozinho (sem UPSERT) | 0% | **0%** | **-6,8%** | 0% | Baixo | Baixo | ⭐ | 95% |
| TTL 90d / 180d | 0% | 0% | **+180% / +447% (PIORA)** | 0% | — | — | ❌ | 95% |
| Índice em `curator_deal_songs` | **0%** | +pequeno | +16 kB | 0% | — | — | ❌ | 99% |

---

## Conclusões

1. **Uma única mudança de 1 linha** (remover `placement_priority_scores` da publicação Realtime) devolve a maior fatia de CPU do banco — é o item #1 por uma margem enorme.
2. **TTL não resolve `placement_priority_scores`.** A tabela tem 38 dias de vida; TTL de 90/180 dias apenas autoriza crescer para 11–21 GB. Só o modelo UPSERT (-99,5%) resolve.
3. **Os 76% de temp files** da Onda 2 são resolvidos por `SET LOCAL work_mem` — medido, não estimado.
4. **Duas recomendações anteriores foram derrubadas pela simulação:** índice em `curator_deal_songs` (tabela de 18 linhas, 0,056 ms) e TTL como estratégia para PPS.
5. `idx_scan = 0` em chaves primárias **não** significa índice inútil — nenhuma PK entrou na lista de remoção.
6. Economia direta de fatura hoje: modesta (~$1–2/mês). O valor real é evitar o upgrade de instância que a trajetória atual (+37 GB/ano, 60% de CPU em decoder) forçaria em ~6 meses.

**Nada foi alterado em produção nesta onda.**
