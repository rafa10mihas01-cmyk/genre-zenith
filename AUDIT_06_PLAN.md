# AUDIT 06 — Plano de Execução Consolidado

**Síntese de Fases 1→5.** Mapa operacional + sequência segura de limpeza.

---

## 📊 Veredito geral da NexEngine

| Camada | Saúde | Dívida principal |
|---|---|---|
| **Frontend** | 🟢 Boa | 38 cores hard-coded + 1 contexto suspeito |
| **Páginas/rotas** | 🟢 Boa | Sidebar canônico já consolidado |
| **Hooks/contexts** | 🟢 Boa | Tudo consumido, AuthContext bem centralizado |
| **Edge functions** | 🟡 Média | 9 órfãs confirmadas + crons duplicados |
| **Crons (`pg_cron`)** | 🔴 Ruim | 1 cron 404, 4 cleanups concorrentes, 1 duplicata exata |
| **Banco (`public`)** | 🔴 Ruim | **0 FKs, 0 índices secundários ativos**, snapshots sem TTL |
| **Engine (matemática)** | 🟡 Média | 7 motores de score sem dicionário comum; 5 tabelas de output vazias |

**Conclusão:** o frontend está numa fase saudável. O legado real vive no **banco** (sem integridade referencial nem índices) e na **camada de engine** (motores rodando diariamente sem produzir nada).

---

## 🧹 Limpezas já aplicadas (Fases 1–5)

| # | Camada | Ação | Status |
|---|---|---|---|
| 1 | Frontend | 4 páginas e 4 componentes mortos removidos (Fase 1) | ✅ |
| 2 | Frontend | 2 hooks mortos removidos (Fase 1) | ✅ |
| 3 | Frontend | `Curadores.tsx` órfã removida (Fase 5) | ✅ |
| 4 | Backend | `cron.unschedule('ops-alerts-cron-every-5min')` (parou 288 404/dia) | ✅ |
| 5 | Backend | `cron.unschedule('cron-cleanup-ops-daily')` (cron inativo lixo) | ✅ |
| 6 | Engine | `POSITION_PCT` unificada (verdade única restaurada) | ✅ |

**Total:** 11 arquivos removidos · 2 crons desagendados · 1 fórmula unificada · 0 regressões esperadas.

---

## 🗺️ Plano consolidado por categoria

### REMOVER (ação simples, sem dependências cruzadas)

**Edge functions órfãs (9 confirmadas — Fase 3):**
- `autopilot-all-genres`, `backfill-curator-playlist-meta`, `backfill-playlist-meta`, `cron-backfill-dead`, `wave1-cleanup-run`, `expire-stale-templates`, `fetch-spotify-featured`, `rewatermark-existing-covers`, `test-apify`, `test-enrich`
- **Risco:** Baixo · **Quando:** batch único pós-aprovação

**Tabelas mortas (3 confirmadas — Fase 2):**
- `ai_usage_log` (0 linhas, 0 refs runtime)
- `community_points_ledger` (0 linhas, 0 refs runtime)
- `deprecation_flags` (1 linha, 0 refs runtime)
- **Risco:** Baixo · **Requer:** 1 migration + regeneração de `types.ts`

**A investigar antes de remover (6 candidatas):**
- `ai_print_cache`, `deprecation_blocked_jobs`, `community_campaigns`, `campaign_eco_snapshots`, `playlist_cooldowns`, `playlist_adjustment_impacts`
- 5 tabelas de engine vazias mas com cron ativo: `track_ecosystem_score`, `track_playlist_fit`, `recommendation_outcome`, `recommendation_feedback`, `playlist_adjustment_impacts` — decidir: **reparar cron** ou **remover tabela+cron+função**

### UNIFICAR (consolidação semântica)

| Item | O que unificar | Risco |
|---|---|---|
| Cleanups noturnos | 4 jobs às 03:00 + 1 às 04:00 em um único job sequencial | Médio |
| Track Ecosystem Score | `tes-daily-recalc` e `wave-track-ecosystem-score-daily` (mesma função, mesmo horário) | Médio — decisão sobre qual cron fica |
| Snapshot patterns | 4 famílias de history (`curator_brain_history`, `playlist_brain_history`, `genre_models_history`, `curator_deal_snapshots`) — adotar 1 padrão + TTL 90d | Médio |
| Scoring engine | Criar `supabase/functions/_shared/scoring.ts` com normalizadores + magic numbers nomeados | **Alto** (migrar 1 motor por vez) |

### REFATORAR (mudanças invasivas)

| Item | Por quê | Risco |
|---|---|---|
| Adicionar **foreign keys** nas 12 relações principais | Banco hoje sem nenhuma FK em `public` | Alto — limpar órfãos antes |
| Adicionar **índices** em `(curator_id)`, `(playlist_id)`, `(deal_id)`, `(created_at DESC)` nas top-10 tabelas | 0 idx_scan hoje, tudo é seq scan | Baixo — só performance |
| Migrar 38 cores hard-coded para tokens semânticos | Quebra a Core Memory do design system | Médio |
| `execution-planner-every-minute` → `*/5 * * * *` ou trigger-based | Roda 1440×/dia para 0 trabalho útil 99% do tempo | Médio |
| Remover `ThemeContext` se confirmado não-usado | App é dark-only fixo | Baixo |

### MANTER (validado)

- Sidebar canônico (Cockpit · Operação · Inteligência · Admin)
- AuthContext, SidebarContext (uso saudável)
- `_shared/rate-limit.ts` + `ai_quota_user` (sistema vivo)
- `handle-email-suppression`, `handle-email-unsubscribe`, `preview-transactional-email` (utilitários externos)
- `bot-*` endpoints (chamados por bot externo, fora do grep)
- shadcn primitives com classes hard-coded (`drawer.tsx`, `toast.tsx`, `dialog.tsx`)

### MIGRAR (decisões de produto, não de código)

- **Recommendation loop**: o cron `detect-recommendation-outcomes` roda diariamente mas `recommendation_outcome` está vazia. Decisão: ativar de verdade ou aposentar?
- **Winner Score v2 (`compute-winner-scores`)**: silo paralelo desconectado de `playlist_brain`. Decisão: integrar ou aposentar?
- **Comunidade**: `community_campaigns`, `community_points_ledger`, `community_invites` praticamente vazios. Módulo está vivo ou em hibernação?

---

## 🎯 Sequência recomendada (próximas 3 ondas)

### Onda 1 — Limpeza segura (1 sessão)
1. Deletar as 9 edge functions órfãs em batch
2. DROP das 3 tabelas mortas (`ai_usage_log`, `community_points_ledger`, `deprecation_flags`) em 1 migration
3. Remover `ThemeContext` se confirmado morto
4. **Risco total:** baixo · **Ganho:** -12 unidades de superfície morta

### Onda 2 — Performance (1 sessão)
1. Adicionar índices nas top-10 tabelas
2. Mudar cadência do `execution-planner`
3. Consolidar os 4 cleanups noturnos em 1 job sequencial
4. Resolver duplicata `tes-daily-recalc` / `wave-track-ecosystem-score-daily`
5. **Risco total:** médio · **Ganho:** -5 crons, +10× velocidade de query

### Onda 3 — Integridade & Engine (2–3 sessões)
1. Limpar órfãos cross-table (curadores sem deals, deals sem playlist, etc.)
2. Adicionar foreign keys com `ON DELETE` apropriado
3. Criar `_shared/scoring.ts`, migrar motores 1×1
4. Unificar pattern de snapshots + TTL
5. Migrar 38 hard-coded colors → tokens
6. **Risco total:** alto · **Ganho:** sistema auditável, escalável, previsível

---

## 📌 Decisões pendentes para o usuário

Antes da Onda 1 começar, preciso de:

1. **Recommendation loop** — ativar de verdade ou aposentar `recommendation_outcome` + `recommendation_feedback` + `detect-recommendation-outcomes`?
2. **Winner Score v2** — integrar com o brain ou aposentar `compute-winner-scores`?
3. **Comunidade** — módulo vivo? (define se `community_*` tables ficam ou saem)
4. **Track Ecosystem Score duplicata** — qual cron é a verdade: `tes-daily-recalc` ou `wave-track-ecosystem-score-daily`?

Com essas 4 respostas, dá pra executar a Onda 1 inteira numa sessão e a Onda 2 logo em seguida com confiança.

---

## ✅ Fechamento da auditoria

**6 relatórios produzidos:**
- `AUDIT_01_INVENTORY.md`
- `AUDIT_02_DATABASE.md`
- `AUDIT_03_BACKEND.md`
- `AUDIT_04_ENGINE.md`
- `AUDIT_05_FRONTEND.md`
- `AUDIT_06_PLAN.md` (este)

**Visão final:** a NexEngine é um sistema com frontend já maduro, mas com um banco que cresceu sem disciplina (zero integridade referencial, zero índices, snapshots descontrolados) e uma camada de engine fragmentada em 7 motores de score paralelos. A boa notícia: **nada está quebrado em produção** — está tudo funcionando, só não está escalável. A Onda 1 já pode rodar agora; as Ondas 2 e 3 dependem de decisões de produto e janela de manutenção.
