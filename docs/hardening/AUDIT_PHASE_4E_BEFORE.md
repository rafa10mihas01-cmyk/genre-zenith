# AUDITORIA — FASE 4.E (BEFORE)
**Hardening de Crons e Jobs**
Data: 17/06/2026

## ITEM 1 — Inventário

Fontes auditadas:
- `pg_cron` (`cron.job`) → **77 jobs agendados** (69 ativos, 8 desativados).
- Edge functions com sufixo `*-cron` / `*-batch` / `reap-*` / `recover-*` / `*-scheduler` → 17 funções.
- VPS scheduler (`nexengine-scheduler` PM2) chamando `jobs-scheduler` com `scope=main|retry|print`.

### Top 30 jobs ativos (resumo)

| # | Job (pg_cron) | Schedule | Executor |
|---|---|---|---|
| 1 | `auto-complete-campaigns-daily` | `0 6 * * *` | edge: `auto-complete-campaigns` |
| 2 | `bot-execution-queue-internal-1min` | `* * * * *` | edge: bot queue tick |
| 3 | `build-reference-pool-daily` | `30 6 * * *` | edge |
| 4 | `campaign-cleanup-dryrun` | `0 4 * * *` | edge |
| 5 | `cleanup-brain-every-6h` | `0 */6 * * *` | edge |
| 6 | `cleanup-old-bot-prints-daily` | `45 3 * * *` | SQL |
| 7 | `cleanup-old-logs-and-snapshots` | `0 2 * * *` | SQL |
| 8 | `cleanup-rate-limits-ai-cache-daily` | `30 3 * * *` | SQL |
| 9 | `cluster-playlists-weekly` | `0 3 * * 0` | edge |
| 10 | `compute-genre-affinities-weekly` | `0 4 * * 1` | edge |
| 11 | `compute-leadership-daily` | `30 3 * * *` | edge |
| 12 | `compute-trend-velocity-daily` | `0 6 * * *` | edge |
| 13 | `cron-deal-delivery-check-daily` | `0 9 * * *` | edge |
| 14 | `cron-health-monitor-10min` | `*/10 * * * *` | edge |
| 15 | `curator-brain-calc-daily` | `0 9 * * *` | edge |
| 16 | `curator-deal-followup-daily` | `0 8 * * *` | edge |
| 17 | `daily-collect-03h15` | `15 3 * * *` | edge |
| 18 | `deliver-system-alerts-every-1min` | `* * * * *` | edge |
| 19 | `detect-curator-fraud-daily` | `0 6 * * *` | edge |
| 20 | `detect-genre-drift-weekly` | `0 2 * * 0` | edge |
| 21 | `detect-trend-events-daily` | `30 6 * * *` | edge |
| 22 | `enqueue-catalog-snapshots-hourly` | `* * * * *` | edge |
| 23 | `evaluate-adjustment-impacts-daily` | `0 6 * * *` | edge |
| 24 | `evaluate-plan-snapshots-daily` | `0 3 * * *` | edge |
| 25 | `execution-planner` | `* * * * *` | edge |
| 26 | `expire-draft-campaigns` | `*/30 * * * *` | SQL |
| 27 | `genre-benchmarks-calc-daily` | `0 6 * * *` | edge |
| 28 | `genre-brain-recompute-daily` | `0 4 * * *` | edge |
| 29 | `learn-genre-lexicon-weekly` | `30 2 * * 0` | edge |
| 30 | `monitor-critical-crons` | `7 * * * *` | edge |

(+47 outros — total 77)

### Respostas
- **Cron sem dono?** SIM — 3 ativos não possuem edge function correspondente (`reset-stuck-bot-songs`, `cleanup-old-bot-prints-daily`, `reconcile-genre-counts-daily` → executam só SQL inline; ok mas não constam em `cron_run_log`).
- **Cron duplicado?** Parcialmente — `playlist-queue-processor` e `playlist-queue-processor-every-2min` coexistem (este último desativado, ok). `reconcile-curator-deals-6h` e `cron-deal-delivery-check-daily` têm escopo similar mas funções distintas (ok).
- **Cron órfão?** 8 desativados sem cleanup. Edge `diagnose-managed-playlists-daily` está inactive desde 2026-04.

## ITEM 2 — Idempotência

| Padrão atual | Coverage |
|---|---|
| Crons que escrevem por `upsert` / `on conflict` | ~55% |
| Crons que dependem apenas de SELECT/atualização condicional | ~25% |
| Crons sem proteção (executar 2x produz duplicação) | ~20% |

Casos críticos sem idempotência observados:
- `daily-collect` — duas execuções simultâneas podem disparar `run-search` no mesmo termo.
- `enqueue-catalog-snapshots-hourly` — sem `min_interval`, pode enfileirar duplicado se cron driftar.
- `process-email-queue` — protegido por lock por row, OK.

## ITEM 3 — Locks

- **Advisory locks**: Ausentes nos crons edge. Apenas `playlist-lock.ts` cobre o domínio playlists.
- **Distributed locks**: Não existem — cada execução assume "sou o único".
- Risco: dois `*/1 min` crons disparados pelo VPS + pg_cron em janela coincidente podem colidir.

## ITEM 4 — Retries

- Padrão atual: cada cron implementa retry à mão (8 funções), sem padronização.
- Sem backoff exponencial uniforme. Sem jitter. Sem registro de tentativas (apenas `cron_health.metrics.errors`).

## ITEM 5 — Dead Jobs

- `reap-zombie-jobs` (15min) cobre **apenas** `playlist_execution_jobs` (worker BOT).
- `recover-stuck-print-batches` cobre `bot_print_batches`.
- **Não existe reaper** para `cron_run_log` — run sem `finished_at` fica órfã indefinidamente.
- **Não existe reaper** para `playlist_operation_queue`.

## ITEM 6 — Cron Health

- `cron_health` (legacy) e `cron_run_log` (novo, Fase 4.C.3) coexistem.
- Coverage `cron_run_log`: **0%** (tabela criada, nenhum cron escreve nela ainda).
- Coverage `cron_health`: ~40% (edge crons que importam `_shared/cron-health.ts`).
- Faltam: `worker`, `hostname`, `correlation_id` ligado, retries — só presentes em 3 crons.

## ITEM 7 — Dependências

Cadeia identificada:
```
daily-collect → run-search → analyze-genre → genre-brain-recompute-daily
enqueue-catalog-snapshots → catalog_snapshot_queue → process-catalog-placements
bot-execution-queue → reap-zombie-jobs (recuperação)
```
- **Execução fora de ordem?** Possível em `daily-collect` (03h15) vs `genre-brain-recompute-daily` (04h00) — janela apertada.
- **Dependência circular?** NÃO.
- **Corrida entre crons?** Risco em `*/1 min` (3 crons concorrendo).

## ITEM 8 — Failover

| Cenário | Comportamento atual |
|---|---|
| Worker morto mid-run | Run fica pra sempre sem `finished_at` |
| Timeout edge function (150s) | Cron retorna 504, sem retry automático |
| Exceção não tratada | Erro logado em `collection_logs`, sem alerta |
| Banco indisponível | Falha total, sem fila de retry |
| API externa indisponível | Coberto desde Fase 4.D (circuit breaker) |

## Classificação BEFORE

| Item | Status |
|---|---|
| Inventário | 🟡 Bom (completo mas com 8 desativados sem cleanup) |
| Idempotência | 🟠 Atenção (~20% sem proteção) |
| Locks distribuídos | 🔴 Crítico (ausentes) |
| Retries padronizados | 🟠 Atenção (cada um na sua) |
| Dead-job recovery | 🟠 Atenção (parcial) |
| Cron health uniforme | 🟠 Atenção (40% coverage) |
| Failover banco/worker | 🟠 Atenção |

**Nível de confiabilidade operacional BEFORE: 6.8 / 10**
