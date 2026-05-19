# AUDIT 02 — Banco de Dados (Executivo)

**Escopo:** schema `public` — 95 tabelas + 9 views. Pente-fino: tabelas mortas, FKs, índices, snapshots redundantes, consistência semântica.

---

## 🔴 CRÍTICO

### C1. Banco SEM foreign keys (0 FKs em `public`)
- **Por que existe:** o schema cresceu rápido e nunca consolidou relacionamentos formais (`curator_id`, `playlist_id`, `deal_id`, `client_id` são apenas `uuid`/`text` soltos).
- **Faz sentido?** Não. Integridade referencial hoje depende 100% do código de aplicação/edge functions.
- **Impacto:** órfãos silenciosos em `curator_deal_*`, `playlist_*_history`, `campaign_allocations`. Já vimos isso na limpeza de Curadores↔Deals.
- **Risco de remoção:** N/A (adicionar, não remover).
- **Recomendação:** **REFATORAR (Fase 6)** — adicionar FKs com `ON DELETE CASCADE/SET NULL` nas 12 relações principais. Requer migration cuidadosa com limpeza prévia de órfãos. **NÃO é BAIXO risco** — fica para o plano final.

### C2. Zero índices secundários ativos
- **Achado:** `pg_stat_user_tables` mostra `idx_scan = 0` em todas as tabelas com >1k linhas (incluindo `search_tracks` 17k, `bot_events` 11k, `curator_deal_snapshots` 6.5k).
- **Impacto:** todo filtro por `curator_id`, `playlist_id`, `created_at` faz seq scan. Lento e vai piorar.
- **Recomendação:** **REFATORAR (Fase 6)** — criar índices em `(curator_id)`, `(playlist_id)`, `(deal_id)`, `(created_at DESC)` nas top-10 tabelas. Migration de baixo risco mas precisa medir antes/depois.

---

## 🟠 ALTO

### A1. Snapshots/history paralelos e redundantes
| Família | Tabelas | Total | Problema |
|---|---|---|---|
| Brain | `curator_brain` + `_history`, `playlist_brain` + `_history` | 4 | 2 fontes de verdade + 2 históricos crescendo (2.2k linhas em `playlist_brain_history`) sem TTL |
| Snapshots | `curator_deal_snapshots` (6.5k), `playlist_metrics_snapshots` (282), `campaign_eco_snapshots` (0), `learning_snapshots` (8) | 4 | Sem política de retenção; `curator_deal_snapshots` é a maior tabela do banco |
| Genre models | `genre_models` (8) + `_history` (60) | 2 | History 7x maior que a fonte → snapshots redundantes |

- **Recomendação:** **UNIFICAR (Fase 6)** — adotar 1 padrão de snapshot (timestamped row + view "current") e TTL de 90 dias. **MÉDIO risco**.

### A2. 47 tabelas com ≤3 referências no código
Mapeadas no inventário. Candidatas a remoção após Fase 3 confirmar que edge functions não as usam em produção real.

---

## 🟡 MÉDIO

### M1. Tabelas 100% mortas (0 linhas + 0 uso no código de runtime)
| Tabela | Linhas | Refs runtime | Ação |
|---|---|---|---|
| `ai_usage_log` | 0 | 0 (só types.ts) | **REMOVER** |
| `community_points_ledger` | 0 | 0 (só types.ts) | **REMOVER** |
| `deprecation_flags` | 1 | 0 (só types.ts) | **REMOVER** |
| `ai_print_cache` | 0 | 1 (1 edge function não-crítica) | Investigar |
| `ai_quota_user` | 0 | 1 (`_shared/rate-limit.ts`) | **MANTER** (usado por shared) |
| `deprecation_blocked_jobs` | 0 | 1 | Investigar |
| `community_campaigns` | 0 | 1 | Investigar |
| `community_participations` | 0 | 3 | **MANTER** (comunidade ainda viva) |
| `campaign_eco_snapshots` | 0 | 2 | Investigar (engine Eco) |
| `campaign_eco_allocations` | 0 | 4 | **MANTER** |
| `playlist_cooldowns` | 0 | 1 | Verificar fluxo |
| `playlist_adjustment_impacts` | 0 | 1 | Verificar fluxo |
| `recommendation_feedback` | 0 | 4 | Verificar se loop ainda escreve |
| `recommendation_outcome` | 0 | 2 | Verificar se loop ainda escreve |

**Risco de remoção (tabelas com 0 refs):** muito baixo — sem dados e sem código que dependa.

### M2. Views órfãs ou redundantes
9 views em `public` (`v_brain_health`, `v_campaign_velocity`, `v_curator_balance`, `v_curator_finance`, `v_curator_global_finance`, `v_dispatch_trace`, `v_playlist_delivery_history`, `v_playlist_vps_assignment`, `genres_with_health`). Pendente cross-check de uso no frontend (Fase 5).

### M3. Pares redundantes a investigar
- `chart_position_benchmarks` (200) vs `genre_benchmarks` (7) — sobreposição conceitual
- `track_ecosystem_score` (4) vs `playlist_ecosystem_score` (392) — par lógico, OK manter
- `track_playlist_fit` (16) vs `playlist_brain` (134) — possível duplicação semântica
- `replications` + `replication_rules` — ambas com pouco uso, validar se módulo está vivo

---

## 🟢 BAIXO — APLICADO NESTA FASE

Conservador por padrão: **DROP TABLE de schema é tecnicamente reversível mas semanticamente alto risco** (perde dados, quebra cache de tipos, requer regeneração de `types.ts`).

**Decisão:** marcar os 3 candidatos óbvios (`ai_usage_log`, `community_points_ledger`, `deprecation_flags`) para o **batch único da Fase 6**, junto com os outros 8-10 confirmados pós-Fase 3. Evita 3 migrations seguidas e 3 regenerações de types.

**Aplicado agora:** 0 mudanças destrutivas. Toda evidência consolidada para limpeza coordenada na Fase 6.

---

## Resumo numérico

| Severidade | Achados |
|---|---|
| 🔴 Crítico | 2 (FKs ausentes, índices ausentes) |
| 🟠 Alto | 2 (snapshots redundantes, 47 tabelas pouco usadas) |
| 🟡 Médio | 14 candidatas a remoção + 9 views a auditar + 4 pares redundantes |
| 🟢 Baixo aplicado | 0 (consolidado para Fase 6) |

## Próxima fase

**Fase 3 — Backend / Edge Functions / Crons.** Vai cruzar com este relatório: cada tabela "suspeita" aqui ganha veredito final (mantém / remove) baseado em quem realmente escreve nela em produção.
