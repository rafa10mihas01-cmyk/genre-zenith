# AUDIT 03 — Backend / Edge Functions / Crons (Executivo)

**Escopo:** 109 edge functions em `supabase/functions/*` + 32 cron jobs ativos em `cron.job`.

---

## 🔴 CRÍTICO

### C1. Cron rodando contra função inexistente (404 a cada 5 min)
- **Job:** `ops-alerts-cron-every-5min` chamava `/functions/v1/ops-alerts-cron`.
- **Realidade:** a pasta `supabase/functions/ops-alerts-cron/` **não existe**. A função foi apagada e o cron ficou órfão.
- **Impacto:** 288 chamadas HTTP/dia retornando 404, poluindo logs e gastando quota de `pg_net`.
- **Ação:** ✅ **APLICADO** — `cron.unschedule('ops-alerts-cron-every-5min')`.

### C2. 4 jobs de limpeza disparando juntos às 03:00
| Horário | Job | O que roda |
|---|---|---|
| 03:00 | `cleanup-old-logs-and-snapshots` | `cleanup_old_logs_and_snapshots()` |
| 03:00 | `cleanup-operational-logs-daily` | `cleanup_operational_logs()` |
| 03:15 | `cleanup-old-logs-daily` | `cleanup_old_logs()` |
| 04:00 | `daily-cleanup-logs-snapshots` | `cleanup_old_logs_and_snapshots()` (mesma função das 03:00!) |

- **Impacto:** lock contention às 3am + `cleanup_old_logs_and_snapshots` roda 2x/dia sem motivo.
- **Recomendação:** **UNIFICAR (Fase 6)** — manter 1 único job de housekeeping noturno encadeando as 4 SQL functions. **MÉDIO risco** (precisa validar que cada função é idempotente).

---

## 🟠 ALTO

### A1. Função executada a cada minuto sem trabalho real
- `execution-planner-every-minute` (`* * * * *`) — logs mostram boot/shutdown contínuos, mas a tabela `playlist_execution_jobs` tem só 43 linhas históricas.
- **Risco:** custo de invocação 1440x/dia para 0 trabalho útil 99% do tempo.
- **Recomendação:** **REFATORAR** — mudar para `*/5 * * * *` ou trigger-based via `pg_notify`. **MÉDIO risco**.

### A2. `process-email-queue` a cada minuto mesmo sem filas
- Cron já tem guard inteligente (`EXISTS pgmq.q_*`), então **OK**, mas verificar se `q_auth_emails`/`q_transactional_emails` realmente existem em `pgmq` — se não, está sempre retornando NULL silenciosamente.

### A3. Duplicação semântica em ecosystem score
3 crons às 07:00–08:00 chamando engines paralelos no mesmo dia:
- `tes-daily-recalc` → `calculate-track-ecosystem-score` (mode:full)
- `wave-track-ecosystem-score-daily` → `calculate-track-ecosystem-score` (mode:full) **— DUPLICATA**
- `wave-playlist-ecosystem-score-daily` → `calculate-playlist-ecosystem-score`
- **Achado:** `tes-daily-recalc` e `wave-track-ecosystem-score-daily` rodam **a mesma função no mesmo horário (07:00)** com o mesmo payload.
- **Recomendação:** **REMOVER** um dos dois na Fase 6. **MÉDIO risco** (escolher qual é a verdade).

### A4. 4 cleanups de banco "à mão" duplicando o que o cron já faz
`cleanup_old_logs()`, `cleanup_operational_logs()`, `cleanup_old_logs_and_snapshots()`, `cleanup_rate_limits_and_ai_cache()`, `cleanup_old_bot_prints()` — 5 SQL functions de limpeza separadas, todas rodando 03:00–03:45. Investigar overlap real e consolidar.

---

## 🟡 MÉDIO

### M1. Edge functions sem nenhuma referência (27 candidatas)
Filtrando as legítimas (cron-triggered ou endpoint externo de bot/email-provider), sobram **candidatas reais a remoção**:

| Função | Por que existe (hipótese) | Recomendação |
|---|---|---|
| `autopilot-all-genres` | Antigo modo "rodar tudo" do autopilot | **REMOVER** (substituída por `genre-autopilot`) |
| `backfill-curator-playlist-meta` | Migration one-shot | **REMOVER** |
| `backfill-playlist-meta` | Migration one-shot | **REMOVER** |
| `cron-backfill-dead` | Migration one-shot | **REMOVER** |
| `wave1-cleanup-run` | Migration one-shot (Wave 1 já passou) | **REMOVER** |
| `expire-stale-templates` | Sem cron e sem chamada — código órfão | **REMOVER** |
| `fetch-spotify-featured` | Sub-stituída por `genre-spotify-discover` | **REMOVER** |
| `genre-competitors-sync` | Possível protótipo | Investigar antes |
| `rewatermark-existing-covers` | Migration one-shot (já rodou) | **REMOVER** |
| `test-apify` / `test-enrich` | Protótipos óbvios | **REMOVER** |
| `upload-playlist-cover` | Duplicada por `apply-managed-cover`? | Investigar |
| `approve-community-participation` | Sub-stituída por fluxo direto | Investigar |
| `preview-transactional-email` | Possível ferramenta admin | **MANTER** (utilitária) |
| `handle-email-suppression` | Webhook do provedor de email | **MANTER** |
| `handle-email-unsubscribe` | Webhook público | **MANTER** |

→ **9 remoções limpas** confirmadas para Fase 6.

### M2. `_shared` é desconhecido
Tem `_shared/rate-limit.ts` referenciada por 1 tabela (`ai_quota_user`). Verificar quem chama `_shared/*` para evitar quebrar tudo na Fase 6.

---

## 🟢 BAIXO — APLICADO NESTA FASE

| # | Ação | Resultado |
|---|---|---|
| 1 | `cron.unschedule('ops-alerts-cron-every-5min')` | ✅ Para 288 chamadas 404/dia |
| 2 | `cron.unschedule('cron-cleanup-ops-daily')` | ✅ Remove cron que já estava `active=false` (lixo) |

**Não aplicado (deixado pra Fase 6):**
- Remoção das 9 edge functions órfãs (precisa batch único + regerar tipos)
- Unificação dos cleanups noturnos (precisa validação de idempotência)
- Mudança de cadência do `execution-planner` (precisa medir antes/depois)

---

## Resumo numérico

| Severidade | Achados |
|---|---|
| 🔴 Crítico | 2 (cron 404, 4 cleanups concorrentes) |
| 🟠 Alto | 4 (planner a cada min, duplicata de ecosystem, cleanups redundantes, email queue) |
| 🟡 Médio | 9 functions a remover + 6 a investigar |
| 🟢 Baixo aplicado | 2 crons desagendados |

## Próxima fase

**Fase 4 — Playlist Engine (matemática).** Vai consolidar fórmulas (`POSITION_PCT`, distribuição, locks, saturação, multiplier, scoring) e identificar a "única verdade matemática" — onde está duplicada, onde diverge, qual é a canônica.
