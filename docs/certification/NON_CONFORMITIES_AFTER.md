# NON-CONFORMITIES — Estado APÓS Fase 4.F.1

**Data:** 2026-06-17
**Escopo:** fechamento das 8 NCs identificadas pelo Red Team em 2026-06-17.
**Regra:** cada NC validada por evidência objetiva (psql / rg) — documentação não foi aceita.

| ID | Severidade original | Status | Evidência de fechamento |
|---|---|---|---|
| NC-001 | Crítica | **RESOLVIDA** | `pg_trigger` em `curator_deal_snapshots` retorna **apenas** `reject_snapshot_regression`. `trg_reject_snapshot_regression` foi dropado na migration. |
| NC-002 | Crítica | **RESOLVIDA** | 11/11 edge functions de cron usam `serveCron(...)` (wrapper de `withCronJob`): `cron-deal-delivery-check`, `cron-process-catalog-placements`, `cron-reconcile-curator-deals`, `cron-recover-print-batches`, `deliver-system-alerts-cron`, `evaluate-adjustment-impacts`, `external-health-probes-cron`, `monitor-critical-crons`, `ops-alerts-cron-every-5min`, `recover-stuck-print-batches`, `smtp-health-probe-cron`. Confirmado via `grep -l serveCron`. |
| NC-003 | Alta | **RESOLVIDA** | `rg "from\(['\"]curator_deal_snapshots['\"]\)\.insert" supabase/functions` retorna **uma única ocorrência**: `_shared/snapshot-writer.ts:103`. Os 3 call sites legados (`bot-ingest-snapshot`, `_shared/ingest-dom`, `extract-snapshot-from-print`) agora delegam para `writeCuratorDealSnapshot()`. |
| NC-004 | Média | **RESOLVIDA** | `web-vitals@5.3.0` instalado. `src/lib/clientErrorLogger.ts` captura **CLS, LCP, INP, TTFB, FCP** e despacha cada métrica para `log-client-error` como `type:"rum"`. Inicialização disparada por `installClientErrorLogger()` em `src/main.tsx`. |
| NC-005 | Média | **RESOLVIDA** | Query `pg_constraint` ⨯ `pg_index` retorna **0** FKs sem índice de suporte (eram 30). Migration criou 30 índices `IF NOT EXISTS`. |
| NC-006 | Média | **RESOLVIDA** | `pg_class.relrowsecurity = true` em `public._io_stats_snapshots`. Grants restritos: `service_role` only. Policy `service_role full access` ativa; nenhum grant a `anon`/`authenticated`. |
| NC-007 | Baixa | **RESOLVIDA** | `pg_get_functiondef('public.sync_campaign_total_delivered')` mostra a função reescrita: ela **apenas chama** `public.recompute_campaign_total_delivered(campaign_id)` para new e old. Implementação única; trigger e cron compartilham a mesma definição. |
| NC-008 | Baixa | **RESOLVIDA** (falso positivo) | Re-varredura mostra: 0 marcadores `TODO`/`FIXME` reais (os 2 hits eram a palavra portuguesa "TODO" = "todo dia"); todos os `DISABLED`/`LEGACY` restantes são valores legítimos do enum `playlist_execution_mode` ou nomes de constantes (`LEGACY_TAB_MAP` é o registry oficial de redirects). A contagem de 46 do Red Team foi inflada por casamento de substring. Sem ação de código necessária; documentado aqui para rastreabilidade. |

## Resumo

- **Críticas:** 0 (eram 2)
- **Altas:** 0 (era 1)
- **Médias:** 0 (eram 3)
- **Baixas:** 0 (eram 2)
- **Total aberto:** 0
