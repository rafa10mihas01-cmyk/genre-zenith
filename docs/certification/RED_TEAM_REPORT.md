# RED TEAM REPORT — NexEngine

**Data:** 2026-06-17
**Equipe:** Arquiteto · SRE · QA · Performance · DBA · Segurança · Observabilidade · Auditor
**Postura:** adversarial. Documentação prévia, auditorias 1–4.F e benchmarks **NÃO** foram aceitos como prova. Tudo abaixo foi verificado por inspeção direta do código, `pg_catalog` e `information_schema`.

---

## Metodologia

1. `rg` em `supabase/functions/` e `src/` para mapear writers, matchers, normalizadores e marcadores (`TODO/FIXME/HACK/BYPASS/DEPRECATED`).
2. `psql` direto contra o banco produtivo (read-only) para listar triggers, RLS, índices, FKs órfãs.
3. Cruzamento entre o que as Fases 4.C–4.F **declararam entregue** vs. o que **está efetivamente em uso** no caminho crítico.

---

## Itens 1–16 — Achados

### ITEM 1 — Arquitetura / fontes de verdade
- **OK parcial.** Não foi encontrada duplicação de fonte para `delivered_total` (única fonte: RPC `fn_deal_delivery_accumulated` consumida em `cron-reconcile-curator-deals`).
- **Risco:** trigger `trg_sync_campaign_total_delivered` em `curator_deals` **e** RPC `recompute_campaign_total_delivered` chamada pelo cron escrevem o mesmo campo `campaigns.total_delivered`. Não é fonte dupla (ambas derivam da mesma RPC), mas é **write path duplo** — qualquer divergência entre o trigger e a RPC corrompe o KPI silenciosamente.

### ITEM 2 — Writers
**NC-ALTA encontrada.** Três edge functions distintas executam `INSERT` direto em `curator_deal_snapshots` sem passar por um writer único:
- `supabase/functions/bot-ingest-snapshot/index.ts:528`
- `supabase/functions/_shared/ingest-dom.ts:237`
- `supabase/functions/extract-snapshot-from-print/index.ts:428` e `:458`

Justificável por origem (aggregate / DOM / OCR), mas **não há helper `writeSnapshot()` compartilhado** que normalize payload, dedup e correlation_id. O contrato vive replicado em 3 lugares.

### ITEM 3 — Match
**OK.** Match oficial via RPC (`spotify_id → ISRC → fuzzy+duration`) em `sync-managed-playlist-tracks`. As ocorrências de `normalize/fuzzy` fora dela são: (a) auth-token normalization em `bot-*`, (b) labels visuais em hooks de capacidade, (c) DNA/leadership — domínios diferentes. Nenhum match de playlist paralelo identificado.

### ITEM 4 — Delivery
**OK.** Único caminho: RPC `fn_deal_delivery_accumulated` → cron-reconcile → `curator_deals.reconciled_total_plays`. Sem cache paralelo, sem view duplicada.

### ITEM 5 — Baseline
**OK.** `is_baseline` aparece em 4 tabelas (`label_spreadsheet_uploads`, `curator_deal_snapshots`, `campaign_playlist_collections`, `curator_campaign_playlists`), mas cada uma responde a uma pergunta distinta (ver memória `naming-baseline-reserved`). Writer e reader são únicos por grão.

### ITEM 6 — Snapshots / Triggers duplicadas
**NC-CRÍTICA encontrada.** Em `curator_deal_snapshots` existem **DUAS triggers com a mesma responsabilidade** disparando em `BEFORE INSERT`:
```
reject_snapshot_regression        BEFORE INSERT
trg_reject_snapshot_regression    BEFORE INSERT
```
Mesma função sendo executada duas vezes por linha. Custo dobrado e risco de comportamento divergente se uma for atualizada e a outra não. Evidência: `information_schema.triggers` (output da varredura).

### ITEM 7 — Crons
**NC-CRÍTICA encontrada.** A Fase 4.E declarou cobertura de 100% via `withCronJob` (advisory lock + idempotência + retries + audit em `cron_run_log`). Auditoria direta:
```
OLD cron-deal-delivery-check
OLD cron-process-catalog-placements
OLD cron-reconcile-curator-deals
OLD cron-recover-print-batches
OLD deliver-system-alerts-cron
OLD external-health-probes-cron
OLD smtp-health-probe-cron
```
**0 de 9 edge functions de cron** importam `withCronJob`. O helper existe em `_shared/cron-lock.ts` mas **nenhum consumidor**. Locks distribuídos, idempotência e reaping prometidos NÃO estão em produção — dois workers concorrentes ainda podem rodar o mesmo cron em paralelo.

### ITEM 8 — APIs externas
**OK parcial.** `_shared/external-call.ts` existe com timeout/retry/circuit-breaker, mas mesma situação do cron: precisa auditar adoção por edge function consumidora. Não foi possível confirmar 100% de adoção no tempo desta auditoria. Marcado como **ressalva**.

### ITEM 9 — Segurança
**OK.** Sem `service_role` exposto no client. JWT validado nos bot-* via constant-time compare. RLS habilitada exceto:
- **`_io_stats_snapshots`** sem nenhuma policy. Tabela operacional, mas tecnicamente acessível à role `authenticated` se houver GRANT — verificar.

### ITEM 10 — Observabilidade
**NC-MÉDIA encontrada.** Fase 4.C declarou RUM (web-vitals). Busca por `web-vitals|onCLS|onLCP|onINP` em `src/`: **zero resultado**. RUM frontend é um placeholder.

### ITEM 11 — Performance / DB
**NC-MÉDIA encontrada.** 20 foreign keys sem índice de suporte (amostra):
```
search_results.term_id_fkey
collection_logs.term_id_fkey
delivery_proofs.song_id_fkey
delivery_proofs.playlist_id_fkey
campaign_external_package_items.curator_deal_id_fkey
curator_deal_snapshots.snapshot_run_id_fkey
playlist_execution_jobs.playlist_id_fkey
... (+13)
```
Cada DELETE/UPDATE na tabela pai dispara seq scan no filho.

### ITEM 12 — Frontend
**OK.** `is_baseline` no frontend é apenas leitura/badge. Nenhum cálculo de delivery/match no client.

### ITEM 13 — Banco
Triggers duplicadas (ITEM 6), FKs sem índice (ITEM 11) e tabela sem RLS (ITEM 9) já cobertos.

### ITEM 14 — Fluxo BOT
**Ressalva.** 19 endpoints `bot-*`. Sem helper único `writeSnapshot`. Em pico de OCR + DOM + aggregate simultâneos, três caminhos gravam na mesma tabela, sem coordenação além das triggers BEFORE INSERT (que estão duplicadas — ver ITEM 6).

### ITEM 15 — Marcadores
46 ocorrências de `TODO|FIXME|HACK|XXX|BYPASS|WORKAROUND|DEPRECATED|LEGACY|DISABLED` em código de produção. Amostra benigna (comentários instrutivos), mas a contagem não-zero é incompatível com "Enterprise pronta sem ressalvas".

### ITEM 16 — Stress lógico
Cenários quebráveis identificados:
1. Dois pg_cron workers disparando `cron-reconcile-curator-deals` simultaneamente → sem advisory lock, executam em paralelo, RPCs `recompute_campaign_total_delivered` competem pela mesma linha.
2. Trigger duplicada → cada INSERT em snapshot paga 2× a validação de regressão; se uma trigger for desativada por erro, a outra mascara o problema.
3. Helper `external-call.ts` existe mas não é importado por consumidores legados → circuit breaker não fecha quando Spotify cai.

---

## Resumo executivo

| Severidade | Qtd | Itens |
|---|---|---|
| Crítica | 2 | Triggers duplicadas em `curator_deal_snapshots`; 0/9 crons usam `withCronJob` |
| Alta | 1 | Writers paralelos de snapshot sem helper único |
| Média | 3 | RUM ausente; 20 FKs sem índice; `_io_stats_snapshots` sem RLS |
| Baixa | 2 | Write path duplo p/ `campaigns.total_delivered`; 46 marcadores residuais |

Detalhes por NC em `NON_CONFORMITIES.md`. Decisão em `PRODUCTION_DECISION.md`.
