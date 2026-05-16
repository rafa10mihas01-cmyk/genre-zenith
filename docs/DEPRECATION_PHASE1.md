# Aposentadoria — Fase 1 (Desligar Execução)

Status: em rollout. Nada é deletado nesta fase — apenas instrumentado, desligado e bloqueado de forma reversível.

## Funções-alvo (27)

### Bloco autopilot/criação (11)
genre-autopilot, autopilot-all-genres, analyze-genre, generate-playlists-briefing,
extract-blueprints, generate-templates, score-templates, expire-stale-templates,
replicate-top, auto-replicate-playlists, create-spotify-playlist

### Bloco CO Apify (14)
run-search, enrich-playlists, fetch-tracks-spotify, fetch-spotify-featured,
genre-competitors-sync, genre-backfill, cron-backfill-dead, collect-batch,
daily-collect, generate-terms, seed-editorial-terms, learning-loop,
extract-replication-rules, revalidate-dataset

### Bloco auxiliar de criação de capa (2)
generate-cover-variations, analyze-genre-visual-dna

## Dependências externas detectadas (Passo 0)

Funções ativas (NÃO deprecated) que ainda chamam alvos — precisam de fix antes do kill-switch:

| Caller (mantido) | Chama (deprecated) | Local | Ação Fase 1 |
|---|---|---|---|
| `cleanup-brain` | `analyze-genre` | `cleanup-brain/index.ts:264` | Remover chamada (cleanup roda fora do pipeline de descoberta) |
| `cleanup-brain` | `analyze-genre-visual-dna` | `cleanup-brain/index.ts:270` | Remover chamada |
| `analyze-performance` | `extract-replication-rules` | `analyze-performance/index.ts:267` | Tornar opcional (skip se 410) |

Todas as demais chamadas function→function entre alvos já estão contidas dentro do próprio grupo deprecated.

Cron em `cron.job` referenciando alvos: **zero** (varredura `rg net.http_post supabase/migrations` retornou vazio para nomes-alvo). Os 3 cron jobs ativos relacionados foram identificados via `cron.job`:

- jobid 19 `backfill-dead-genres-6h` → `cron-backfill-dead`
- jobid 8  `learning-loop-daily` → `learning-loop`
- jobid 28 `recover-stuck-auto-collect` → `recover-stuck-auto-collect` (watchdog do pipeline)

## SQLs de rollback dos crons

```sql
-- backfill-dead-genres-6h
SELECT cron.schedule('backfill-dead-genres-6h', '17 */6 * * *', $$
  SELECT net.http_post(
    url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/cron-backfill-dead',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', public.get_cron_secret()),
    body := jsonb_build_object('source', 'pg_cron', 'time', now())
  );
$$);

-- learning-loop-daily (jobid 8) — schedule original "0 4 * * *"
-- recover-stuck-auto-collect (jobid 28) — schedule original "*/5 * * * *"
-- (comandos completos preservados em cron.job_run_details — ver histórico antes de revert)
```

## Rollback do kill-switch

Em Lovable Cloud → Secrets, setar `DEPRECATED_PHASE1_ENABLED=false`. Sem deploy necessário, efeito imediato.

## Rollback do trigger guard

```sql
ALTER DATABASE postgres RESET app.deprecation_phase1;
-- ou
DROP TRIGGER IF EXISTS guard_deprecated_jobs ON public.jobs_queue;
```

## Cronograma

- **Dia 0** — Telemetria + UI desabilitada deployadas; kill-switch presente mas OFF.
- **Dia 1** — Revisar `deprecation_hits`. Se nenhum hit de `cron`/`internal`, ligar kill-switch.
- **Dia 2** — `cron.unschedule` dos 3 jobs + ligar GUC do trigger.
- **Dia 2–9** — Observar painel `/sistema` → aba Aposentadoria.
- **Dia 9** — Relatório → decidir Fase 2.
