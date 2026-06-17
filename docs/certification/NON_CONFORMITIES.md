# NON-CONFORMITIES — Red Team Audit 2026-06-17

Cada NC abaixo foi verificada por evidência direta (código ou `pg_catalog`). Documentação prévia foi descartada.

---

## NC-001 — Triggers duplicadas em `curator_deal_snapshots` `[CRÍTICA]`

- **Evidência:** `information_schema.triggers` retorna
  ```
  reject_snapshot_regression        BEFORE INSERT
  trg_reject_snapshot_regression    BEFORE INSERT
  ```
  na mesma tabela.
- **Arquivo / linha:** banco — migrations históricas (não-localizadas em uma única revisão; ambas ativas em produção).
- **Impacto:** custo 2× por linha; comportamento divergente se uma for atualizada sem a outra; risco de erro silencioso em rollback.
- **Probabilidade:** 100% (ocorre em todo INSERT).
- **Severidade:** crítica.
- **Reprodução:** `select tgname from pg_trigger where tgrelid='public.curator_deal_snapshots'::regclass and not tgisinternal;`
- **Correção:** identificar a definição canônica via `pg_get_triggerdef` e `DROP TRIGGER reject_snapshot_regression` (ou o duplicado). Migration única.

---

## NC-002 — Crons não adotaram `withCronJob` `[CRÍTICA]`

- **Evidência:** `grep -L withCronJob supabase/functions/{cron-*,*-cron}/index.ts` → 9/9 sem o wrapper.
- **Arquivos:** `cron-deal-delivery-check`, `cron-process-catalog-placements`, `cron-reconcile-curator-deals`, `cron-recover-print-batches`, `deliver-system-alerts-cron`, `external-health-probes-cron`, `smtp-health-probe-cron`, `recover-stuck-print-batches`, `evaluate-adjustment-impacts`.
- **Impacto:** lock distribuído, idempotência, retries padronizados e `cron_run_log` não estão em vigor. Dois workers podem executar o mesmo cron em paralelo (race em `recompute_campaign_total_delivered`).
- **Probabilidade:** média (depende do scheduler disparar dois jobs antes do anterior terminar).
- **Severidade:** crítica em ambiente 24×7.
- **Reprodução:** disparar manualmente o cron duas vezes em <1s e observar `cron_run_log`. Não haverá `skipped: locked`.
- **Correção:** envolver cada `Deno.serve(...)` com `withCronJob(sb, { job_name, max_retries, timeout_ms }, async (ctx) => { ... })`. PR por cron, validar `cron_run_log`.

---

## NC-003 — Writers paralelos em `curator_deal_snapshots` `[ALTA]`

- **Evidência:** três paths fazem `INSERT` direto:
  - `supabase/functions/bot-ingest-snapshot/index.ts:528`
  - `supabase/functions/_shared/ingest-dom.ts:237`
  - `supabase/functions/extract-snapshot-from-print/index.ts:428` e `:458`
- **Impacto:** contrato de payload replicado; alteração em uma origem (campos novos, correlation_id, hash de dedup) pode passar despercebida nas outras.
- **Probabilidade:** alta em manutenções futuras.
- **Severidade:** alta.
- **Reprodução:** comparar o objeto enviado nas 3 chamadas — diferem em campos opcionais.
- **Correção:** extrair `_shared/snapshot-writer.ts` com função única `insertCuratorDealSnapshot(sb, payload)` e refatorar os 3 call sites.

---

## NC-004 — RUM declarado mas ausente `[MÉDIA]`

- **Evidência:** `rg "web-vitals|onCLS|onLCP|onINP|reportWebVitals" src` → 0 resultados.
- **Impacto:** Fase 4.C.3 lista "RUM avançado" como entregue/parcial; na prática não há captura de Core Web Vitals no cliente.
- **Severidade:** média (não bloqueia produção, bloqueia certificação Enterprise).
- **Correção:** `bun add web-vitals`; reportar em `clientErrorLogger.ts` via `log-client-error` (`type: 'rum'`).

---

## NC-005 — 20 FKs sem índice de suporte `[MÉDIA]`

- **Evidência:** consulta a `pg_constraint` (top 20 amostrada):
  `search_results.term_id`, `collection_logs.term_id`, `delivery_proofs.song_id`, `delivery_proofs.playlist_id`, `campaign_external_package_items.curator_deal_id`, `curator_deal_snapshots.snapshot_run_id`, `playlist_execution_jobs.playlist_id`, `genre_brain.parent_genre_id`, etc.
- **Impacto:** DELETE/UPDATE em tabela pai → seq scan no filho; locks longos em produção.
- **Severidade:** média.
- **Correção:** migration com `CREATE INDEX CONCURRENTLY` em cada FK listada.

---

## NC-006 — `_io_stats_snapshots` sem policy de RLS `[MÉDIA]`

- **Evidência:** `pg_tables` ⨯ `pg_policies` — única tabela `public` sem policy.
- **Impacto:** se houver `GRANT` para `authenticated`, leitura é livre. Mesmo sem GRANT, tabela quebra a invariante "100% das públicas com RLS" declarada em 4.B e 4.F.
- **Severidade:** média.
- **Correção:** `ALTER TABLE public._io_stats_snapshots ENABLE ROW LEVEL SECURITY;` + policy `service_role only` ou revogar grants e mantê-la interna.

---

## NC-007 — Write path duplo para `campaigns.total_delivered` `[BAIXA]`

- **Evidência:** trigger `trg_sync_campaign_total_delivered` (em `curator_deals`) e RPC `recompute_campaign_total_delivered` chamada pelo cron escrevem o mesmo campo.
- **Impacto:** se a lógica divergir entre as duas, KPI flutua entre execuções.
- **Severidade:** baixa (hoje ambas derivam da mesma fonte).
- **Correção:** transformar o trigger em mero `PERFORM recompute_campaign_total_delivered(NEW.campaign_id)` para garantir uma única definição.

---

## NC-008 — Marcadores residuais `[BAIXA]`

- **Evidência:** 46 ocorrências de `TODO|FIXME|HACK|XXX|BYPASS|WORKAROUND|DEPRECATED|LEGACY|DISABLED` em `supabase/functions/` + `src/`.
- **Impacto:** baixo individualmente, alto somado para uma certificação que se declara "sem dívida".
- **Correção:** triagem em ticket por ticket. Marcadores informativos podem virar comentários neutros.
