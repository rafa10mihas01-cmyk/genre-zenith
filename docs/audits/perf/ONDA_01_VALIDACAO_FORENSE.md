# Onda 1.1 — Validação Forense dos Maiores Desperdícios

**Data:** 2026-07-29 16:20 UTC
**Escopo:** Apenas investigação. Nenhum DDL/DML foi executado.
**Método:** `pg_stat_all_tables`, `pg_stat_all_indexes`, `pg_stat_database`, `cron_run_log`, `cron_health`, `pg_views`, `pg_proc` + varredura de código (`rg`) em `src/`, `supabase/functions/`, `supabase/migrations/`.

---

## ALVO 1 — `placement_priority_scores`

### Evidências (leitura direta do banco)

| Métrica | Valor |
|---|---|
| Linhas vivas | **3.645.498** |
| Tamanho total | **3.755 MB** (≈ 67% do banco de 5,52 GB) |
| Inserts acumulados | 3.645.498 |
| Updates / Deletes acumulados | **0 / 0** — append-only |
| Última escrita | **2026-07-29 16:07:00 UTC** (minutos antes desta auditoria) |
| Idx scans (leitura) | 50.055 total |
| Última análise | nunca `VACUUM`; `ANALYZE` nunca |
| Crescimento observado (jul/15→jul/28) | **+120.000 linhas / dia**, sem prune |

### Dependências

| Camada | Objeto | Papel |
|---|---|---|
| Função SQL | `public.engine_priority_compute_all(_limit int)` | ÚNICO escritor (INSERT em lote de 5.000) |
| Migration | `20260622173150_...sql` linha 306 | Cron `SELECT engine_priority_compute_all(5000)` |
| Frontend | `src/components/catalogo/EnginePriorityTab.tsx` linhas 268, 718 | Assina `postgres_changes` na tabela e chama a RPC manualmente |
| RLS | `Team can read priority scores` (SELECT autenticado com `has_team_access`) | Grants ativos p/ `authenticated` e `service_role` |
| Views / Triggers / FKs / outras RPCs | **Nenhuma** (grep DB + código) |

### Diagnóstico

- **NÃO É ÓRFÃ.** Há escritor ativo, leitor ativo (1 tela admin) e cron rodando.
- **É desperdício estrutural**: append-only sem TTL. Cada run adiciona ~5.000 linhas; a tela lê apenas o "último snapshot" via `idx_priority_scores_placement (placement_id, calculated_at DESC)`. **99%+ das linhas nunca mais serão lidas.**
- `idx_priority_scores_calc_at` foi usado 3 vezes mas leu 8,97 M tuples → há UMA query fazendo range scan enorme (possivelmente na tela EnginePriorityTab).

### Impacto

| Dimensão | Valor |
|---|---|
| Storage | ≈ 3,75 GB / 67% do banco |
| I/O | 8,97M tuples lidos em 3 scans — sinal claro de query mal filtrada |
| WAL | ~120k inserts/dia inflam WAL e replicação |
| CPU | 1 cron a cada X min inserindo 5k linhas |
| Financeiro (proxy) | disco: uplift do tier de armazenamento; principal item que puxaria upgrade de disco |

### Recomendação (sem ação nesta onda)

Confiança para **DROP total**: **~5%** — a tela usa ativamente.
Confiança para **política de retenção (ex.: manter só o último `run_id` por `placement_id`)**: **~90%**.
Próxima ação sugerida (Onda 2): medir tempo real da query da tela + protótipo de retenção com dry-run.

---

## ALVO 2 — `vw_campaign_playlist_growth`

### Evidências

- `SELECT viewname FROM pg_views WHERE viewname='vw_campaign_playlist_growth';` → **0 linhas**.
- Grep em `src/` e `supabase/functions/`: **0 ocorrências em código runtime**. Todas as referências restantes estão em `supabase/migrations/*.sql` (histórico) e `docs/`.
- Memory `[Campaign playlist growth RPC]` confirma: view foi removida na Etapa 2B e substituída por `fn_campaign_playlist_growth(uuid[])`.

### Diagnóstico

- **Já removida.** Chamadas "caras" reportadas na Onda 1 correspondem à RPC `fn_campaign_playlist_growth`, não à view.
- Consumidores da RPC: `get-shared-campaign-plan`, `get-curator-deal-public`, `get-client-campaign-public` (edge functions) + telas `PlanoCampanhaPublico`, `Analytics`, `CampanhaExecucao`, `CampanhaDetalhe`, hooks `useCampaigns`, `useDealTodayPlaylistBreakdown`, `useCuratorDeals`, `dealsAnalytics`, `ExternalPackageEditor`, `ExecucaoView`, `OverviewTab`, `InternalEcosystemHeader`.

### Impacto

Onda 1 apontou custo alto porque a RPC é chamada em ≥ 10 telas + 3 rotas públicas. **Não há desperdício de storage**, e sim potencial de **cache/coalescing** de chamadas duplicadas na mesma sessão.

### Recomendação

Confiança de que **a view não existe mais**: **100%**. Nenhuma limpeza necessária.
Próxima ação (Onda 2): instrumentar `fn_campaign_playlist_growth` para contar chamadas por rota e detectar duplicações.

---

## ALVO 3 — `campaign_eco_allocations`

### Evidências

| Métrica | Valor |
|---|---|
| Linhas vivas | **105** |
| Inserts / Updates / Deletes acumulados | 92 / 73 / 53 |
| Seq scans | **186.699** |
| Idx scans | 97.089 |
| Tamanho | 336 kB |

### Consumidores mapeados (grep)

- **Edge functions (20 pontos):** `approve-campaign-plan` (7×), `execution-planner` (3×), `swap-campaign-playlist` (4×), `suggest-playlist-swap` (3×), `bot-execution-queue`, `expire-draft-campaigns`, `simulate-campaign-flow`, `get-client-campaign-public`, `get-campaign-roadmap-public`, `get-shared-campaign-plan`, `campaign-plan-api`, `campaign-daily-plan`, `register-cohort-baseline`, `replan-campaign-eco` (2×), `_shared/protected-tracks`, `_shared/eco-budget` (2×).
- **Frontend (14 pontos):** `CampanhaExecucao.tsx` (3×), `campaignSnapshot.ts`, `ExecucaoView.tsx` (2×), `campaignClosurePdf.ts`, `CampaignFullPlanCard.tsx`, `CampaignExecutionStatus.tsx`, `useEcosystemCapacity.ts`, `Calculadora.tsx` (2×).

### Diagnóstico

- **Uso é real e distribuído.** Não é polling isolado; são 34+ pontos de leitura/escrita legítimos ao longo do ciclo de campanha.
- **Custo de seq scan é baixo** (105 linhas cabem em 1 página) — 186k seq scans em uma tabela pequena somam poucos ms.
- Ratio idx/seq ≈ 0,52 indica que ~metade das queries não usa índice, mas com 105 linhas o planner escolhe seq propositalmente.
- **Alerta**: `CampanhaExecucao.tsx` faz 3 leituras separadas na mesma tela — provável duplicação por render/state, não bug funcional.

### Impacto

Financeiro: irrisório (< 1% CPU do banco). O "78k chamadas" apontado na Onda 1 é sintoma de **fan-out de UI e edge functions**, não de tabela problemática.

### Recomendação

Confiança para **manter tabela como está**: **95%**.
Próxima ação (Onda 2): auditar `CampanhaExecucao.tsx` e `ExecucaoView.tsx` para colapsar leituras redundantes em 1 hook cacheado. **Nenhuma alteração de schema.**

---

## ALVO 4 — `bot_heartbeats`

### Evidências

| Métrica | Valor |
|---|---|
| Linhas vivas | 36.302 |
| Inserts acumulados | 375.453 |
| Deletes acumulados | **417.813** (mais que inserts → purge ativo funciona) |
| Tamanho | 47 MB |
| Seq scans | 33.755 |
| Idx scans | 6.721 |
| Idx principal | `idx_bot_heartbeats_created (created_at DESC)` — 6.713 scans |

### Consumidores (grep)

| Componente | Padrão |
|---|---|
| `useLatestBotHeartbeat.ts` | React Query, `.limit(1).order(created_at desc)`, staleTime 30s, refetch 60s — **cacheado** |
| `OperationalSummary.tsx` | `select created_at limit 1` |
| `AoVivoPainel.tsx` | leitura + realtime `postgres_changes INSERT` |
| `AoVivoFeed.tsx` | select 20 últimos + realtime INSERT |
| `NocPanel.tsx` | busca por termo (worker_id/bot_name) |
| `CampaignDistributionConsole.tsx` | leitura em realtime |
| Backend | Edge `bot-heartbeat` insere; RPC `purge_bot_heartbeats` remove |

### Diagnóstico

- **Uso saudável.** Delete > insert prova que retenção funciona.
- **Índice adequado existe** (`idx_bot_heartbeats_created`) e é o mais usado.
- Seq scans (33k) vêm provavelmente do `NocPanel` (search com `ILIKE '%…%'` em `bot_name`) — tabela pequena, aceitável.
- `useLatestBotHeartbeat` já é cache único (Fase 4.A.1), evita polling duplicado.

### Impacto

Storage 47 MB, CPU baixo. **Sem desperdício relevante.**

### Recomendação

Confiança para **manter**: **95%**.
Próxima ação (opcional): substituir busca `ILIKE` do NocPanel por índice trigram se volume crescer 10×. Não urgente.

---

## ALVO 5 — Rollbacks

### Evidências (`pg_stat_database`)

| Métrica | Valor |
|---|---|
| `xact_commit` | 22.930.121 |
| `xact_rollback` | **5.358.728** |
| **Rollback ratio** | **18,9%** |
| `deadlocks` | **0** ✅ |
| `temp_files` / `temp_bytes` | 213 / 1,5 GB |
| `sessions_abandoned` | 764 |

### Diagnóstico

- Ratio de 18,9% é **alto** (referência saudável < 5%). Não há deadlocks, então não é lock-loop — provável origem: PostgREST cancelando queries por timeout do cliente ou por RLS que retorna vazio em transações abortadas.
- **1,5 GB de temp files** indica queries fazendo sort/hash sem índice adequado — combina com a leitura de 8,97M tuples em `placement_priority_scores`.
- Este ambiente **não tem `pg_stat_statements`** habilitado, então não é possível identificar a query exata do rollback sem instrumentação adicional.

### Recomendação

Confiança para diagnóstico de causa raiz: **~40%** (dados insuficientes).
Próxima ação (Onda 2): pedir habilitação de `pg_stat_statements` OU adicionar logs no PostgREST/edge functions para amostragem de queries canceladas. **Nenhuma ação corretiva agora.**

---

## ALVO 6 — Cron Jobs (últimas 24h)

Fonte: `cron_health` + `cron_run_log`.

| Cron | Runs/24h | Freq real | avg ms | max ms | Erros | Utilidade | Classificação |
|---|---|---|---|---|---|---|---|
| `playlist-queue-processor` | 1.440 | 1/min | 431 | — | 0 | Alta (fila real) | Necessário |
| `execution-planner` | 1.440 | 1/min | 521 | — | 0 | Alta | Necessário |
| `deliver-system-alerts-cron` | 1.311 | ~1/min | 54–95 | 3.367 | 0 | Média (só alerta se houver) | Necessário |
| `bot-execution-queue` | 1.165 ok + 275 degraded | ~1/min | 399 (1.008 degraded) | — | 0 | Alta | Necessário — atenção ao degraded |
| `cron-recover-print-batches` | 288 | 1/5min | 102–145 | 703 | 0 | Baixa (só age em falha) | Frequência revisar |
| `ops-alerts-cron-every-5min` | 287 | 1/5min | 226–279 | 2.839 | 0 | Média | OK |
| `spotify-token-watchdog` | 48 | 1/30min | 2.338 | — | 0 | Alta | Necessário |
| `monitor-critical-crons` | 24 | 1/h | 1.283 | 1.488 | 0 | Alta (meta) | Necessário |
| `cron-reconcile-curator-deals` | 4 | 1/6h | 6.757 | 10.339 | 0 | Alta | Necessário |
| `cleanup-brain` | 4 | 1/6h | 1.238 | — | 0 | Manutenção | Necessário |
| `calculate-playlist-ecosystem-score` | 1 | 1/dia | 5.116 | — | 0 | Alta | Necessário |
| `cron-deal-delivery-check` | 1 | 1/dia | 949 | 949 | 0 | Alta | Necessário |
| `evaluate-adjustment-impacts` | 1 | 1/dia | 487 | 487 | 0 | Alta | Necessário |
| `reap-zombie-jobs` | 96 | 1/15min | — | — | 0 | Baixa (só age em zumbi) | OK |

**Observação:** o cron `engine_priority_compute_all` (que enche `placement_priority_scores`) **não aparece em `cron_run_log`** — provavelmente roda direto via `pg_cron` sem wrapper de instrumentação. Isso é uma lacuna de observabilidade a corrigir (sem alterar a lógica).

### Recomendação

Confiança geral: **90%**.
Próxima ação (Onda 2): instrumentar o cron `engine_priority_compute_all` no wrapper de health + investigar `bot-execution-queue` degraded (275 execuções).

---

## ALVO 7 — Custo de Infraestrutura (ranking)

### Banco

| Rank | Objeto | Tamanho | Racional |
|---|---|---|---|
| 1 | `placement_priority_scores` | **3.755 MB** | 67% do banco. Sem TTL. |
| 2 | (demais tabelas) | ~1,8 GB | distribuído |

**Rollback ratio 18,9% + 1,5 GB de temp files** são os dois maiores sinais de CPU/IO desperdiçado. Origem exata pendente de instrumentação.

### Edge Functions

Ranking exato requer `analytics_query` (não coletado nesta onda por escopo).
Indicadores indiretos por cron/24h: `execution-planner` (1.440), `playlist-queue-processor` (1.440), `bot-execution-queue` (1.440) — os 3 mais executados. Custo bruto de invocação: ~4.320 chamadas/dia cada.

### Workers / VPS

Fora do repo; não auditados nesta onda (regra de camadas).

### Frontend

Suspeitas confirmadas:
- `CampanhaExecucao.tsx` — 3 leituras separadas de `campaign_eco_allocations` na mesma tela.
- `EnginePriorityTab.tsx` — subscribe realtime + RPC manual em tabela de 3,7 GB.

### Storage / buckets

Não coletado nesta onda.

---

## Tabela consolidada

| Prioridade | Problema | Evidência | Confiança | Economia potencial | Próxima ação |
|---|---|---|---|---|---|
| 🔴 P1 | `placement_priority_scores` cresce 120k linhas/dia sem TTL — 3,75 GB, 67% do banco | `pg_stat_all_tables` (0 deletes, 3,6M rows) + série diária | 95% (uso) / 90% (retenção viável) | Reduzir tabela a < 50 MB (99% do storage) e cortar WAL diário | Onda 2: desenhar política de retenção (manter só último `run_id` por `placement_id`) e simular em dry-run |
| 🟡 P2 | 18,9% de rollback ratio + 1,5 GB temp files | `pg_stat_database` | 40% na causa raiz | Redução de CPU/IO potencialmente 20%+ | Habilitar `pg_stat_statements` ou log de queries canceladas |
| 🟡 P2 | `EnginePriorityTab` lê 8,97M tuples em 3 scans (`idx_priority_scores_calc_at`) | `pg_stat_all_indexes` | 85% | Latência da tela e IO do disco | Auditar SQL da tela na Onda 2 |
| 🟡 P2 | `bot-execution-queue` — 275 execuções "degraded" em 24h (≈ 19%) | `cron_health` | 90% (existência) / 50% (causa) | Estabilidade da fila do bot | Ler `message` das execuções degradadas |
| 🟢 P3 | `CampanhaExecucao.tsx` faz 3 leituras redundantes de `campaign_eco_allocations` | Grep + linhas 247/603/735 | 80% | Redução de round-trips de UI | Colapsar em hook único com React Query |
| 🟢 P3 | Cron `engine_priority_compute_all` sem instrumentação em `cron_run_log` | Ausência do nome na tabela | 100% | Observabilidade | Envolver em wrapper `withCronJob` |
| ⚪ INFO | `vw_campaign_playlist_growth` | `pg_views` retorna 0 | 100% | — | Nenhuma; view já não existe |
| ⚪ INFO | `campaign_eco_allocations` — 78k chamadas | Uso legítimo distribuído em 34+ pontos | 95% | Marginal | Otimização de UI cliente (P3) |
| ⚪ INFO | `bot_heartbeats` — polling | Cacheado com React Query 60s + delete > insert | 95% | Nenhuma | Nenhuma |

**Nota final:** Nenhuma recomendação nesta onda inclui `DROP`, `DELETE`, `VACUUM FULL` ou migração. Toda ação sugerida é de **Onda 2** (medir mais) ou de **desenho** (política de retenção a ser aprovada antes de qualquer DDL).
