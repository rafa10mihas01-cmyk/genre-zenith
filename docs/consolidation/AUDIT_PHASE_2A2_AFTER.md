# Fase 2.A.2 — Consolidação da Família B — Auditor AFTER

> Gerado em 2026-06-17, após a refatoração da Etapa 1.
> **Resultado: dependências remanescentes ≠ 0 → DROP BLOQUEADO. Fase 2.A.3 NÃO liberada.**

---

## Etapa 1 — Refatoração executada

| # | Alvo | Ação | Arquivo |
|---|---|---|---|
| 1 | INSERT em `campaign_allocations` | removido | `src/components/campanhas/NewCampaignDialog.tsx` |
| 2 | UPDATE em `campaign_allocations` (status="live") | removido | `supabase/functions/bot-execution-complete/index.ts` (deployed) |
| 3 | SELECT + DELETE em `campaign_allocations` + botão "Recalcular" + lista de alocações | removidos | `src/pages/CampanhaDetalhe.tsx` |
| 4 | Branch `legacyRes` (lê `campaign_allocations`) | removido — fonte única passou a ser `campaign_eco_allocations` | `supabase/functions/execution-planner/index.ts` (deployed) |
| 5 | Mutation `recalcAll` (RPC `recalc_campaign_progress`) + botão "Recalcular" da lista | removidos | `src/hooks/useCampaigns.ts`, `src/pages/Campanhas.tsx` |

Edge functions deployadas: `bot-execution-complete`, `execution-planner`.
Zero novos caminhos criados. Zero compatibilidade paralela introduzida.

---

## Etapa 2 — Auditor AFTER

### Frontend / Hooks / Componentes React
✅ **0 dependências vivas.**
Buscas em `src/`:
- `campaign_allocations` → só comentários e `types.ts` (auto-gerado).
- `recalc_campaign_progress` → 0 resultados.
- `v_playlist_delivery_history` → 0 resultados.
- `recalcAll` → 0 resultados.

### Edge Functions
✅ **0 dependências em código próprio.**
`rg "campaign_allocations" supabase/functions` → só os comentários "Família B aposentada".
Porém ver SQL functions abaixo: `client-request-adjustment` invoca uma RPC que ainda usa a tabela.

### Triggers
🔴 **2 triggers ainda vivas em `campaign_allocations`:**
| Trigger | Função | O que faz |
|---|---|---|
| `trg_camp_alloc_updated` | `tg_set_updated_at` | timestamp automático — vai embora com a tabela |
| `trg_sync_camp_alloc` | `sync_campaign_total_allocated` | recalcula `campaigns.total_allocated` a cada INSERT/UPDATE/DELETE em `campaign_allocations` |

> Ambas serão removidas automaticamente quando a tabela for dropada — não bloqueiam DROP por si só, mas indicam que `sync_campaign_total_allocated` precisa ser substituída por outra fonte de `total_allocated` (ou o campo aposentado).

### SQL Functions
🔴 **6 funções SQL ainda referenciam Família B:**

| Função | Referencia | Consumidor vivo | Bloqueio |
|---|---|---|---|
| `client_request_adjustment` | `SELECT … FROM campaign_allocations` para montar `allocations` no snapshot do plano de ajuste | Edge function `client-request-adjustment` (portal cliente) → muito ativo | 🔴 **Crítico** |
| `get_campaign_analytics_overview` | `v_playlist_delivery_history` (top/bottom playlists) | Nenhum em código (`Analytics.tsx` já documenta "aposentou") | 🟡 órfão |
| `evaluate_playlist` | `v_playlist_delivery_history` (fulfillment stats) | `evaluate_playlist_by_url` chamado em `src/pages/Valuation.tsx` | 🔴 indireto |
| `evaluate_playlists_batch` | (chama `evaluate_playlist` por baixo) | `src/components/operacao/MinhasPlaylists.tsx` | 🔴 indireto |
| `recalc_playlist_scores` | `v_playlist_delivery_history` (fulfillment_rate por playlist) | provavelmente cron diário | 🔴 |
| `suggest_campaign_playlists` | `campaign_allocations` (exclude_active) | `NewCampaignDialog.tsx:231` | 🔴 |
| `sync_campaign_total_allocated` | grava `campaigns.total_allocated = SUM(target_plays FROM campaign_allocations)` | trigger interna | 🟡 sai junto, mas `total_allocated` fica sem writer |

### Views
🔴 `v_playlist_delivery_history` continua existindo no schema e é consumida por 4 SQL functions acima.

### FKs entrando em `campaign_allocations`
✅ Nenhuma (não há tabela apontando pra ela).

### Cron `recalc-campaign-progress-daily`
🟢 Não tocado nesta etapa — continua agendado, mas chama apenas `recalc_campaign_progress` (que continua existindo).

### Políticas RLS
✅ Não há política em outra tabela referenciando `campaign_allocations`.

---

## Resumo de dependências vivas

| Camada | Status |
|---|---|
| Frontend | ✅ 0 |
| Hooks | ✅ 0 |
| Edge Functions (código próprio) | ✅ 0 |
| Triggers | 🟡 2 (saem com a tabela, mas `sync_campaign_total_allocated` impacta `campaigns.total_allocated`) |
| SQL Functions | 🔴 **6** |
| Views | 🔴 1 (`v_playlist_delivery_history`) |
| Cron `recalc-campaign-progress-daily` | 🟡 cron ainda agendado |
| Cron `client_request_adjustment` (portal) | 🔴 chama RPC que lê `campaign_allocations` |
| RPCs consumidas pelo frontend | 🔴 `suggest_campaign_playlists`, `evaluate_playlists_batch`, `evaluate_playlist_by_url` |

**Total ≠ 0 → DROP BLOQUEADO conforme regra oficial.**

---

## Etapa 2.A.2.b — Plano sugerido para liberar Fase 2.A.3

Cada item abaixo é uma migration/refatoração independente; recomendação é aplicar em ordem.

1. **`get_campaign_analytics_overview`** → DROP da função (órfã; `Analytics.tsx` já anuncia aposentadoria).
2. **`recalc_playlist_scores`** → reescrever bloco `agg_history` lendo de `vw_campaign_playlist_growth` agregada por playlist em vez de `v_playlist_delivery_history`.
3. **`evaluate_playlist`** → reescrever bloco de fulfillment para usar `vw_campaign_playlist_growth` ou aposentar as métricas de "fulfillment" do output (não são mais o motor canônico).
4. **`suggest_campaign_playlists`** → trocar `EXCLUDE existing campaign_allocations` por `EXCLUDE campaign_eco_allocations` (sugestão para campanhas em planejamento já está migrada — só falta a função SQL).
5. **`client_request_adjustment`** → trocar o `SELECT … FROM campaign_allocations` por leitura de `campaign_eco_allocations` (ou pelo `simulation_snapshot` da campaign, que já contém o plano congelado).
6. **`sync_campaign_total_allocated`** + coluna `campaigns.total_allocated`:
   - decidir entre (a) calcular `total_allocated` a partir de `campaign_eco_allocations.planned_streams` via nova trigger, ou (b) aposentar a coluna se já não é exibida (verificar consumidores).
7. **DROP definitivo** após Auditor AFTER zerar:
   - `DROP VIEW v_playlist_delivery_history;`
   - `DROP FUNCTION recalc_campaign_progress(uuid);`
   - `ALTER TABLE campaign_allocations DROP COLUMN delivered_plays;` (ou `DROP TABLE campaign_allocations CASCADE;` se `total_allocated` resolvido)
   - `SELECT cron.unschedule('recalc-campaign-progress-daily');`

---

## Conclusão

A Etapa 1 (refatoração dos 5 pontos listados no Auditor BEFORE) está **100% completa e deployada**.
O Auditor AFTER revelou um **segundo anel de dependências dentro do banco** (6 funções SQL + 1 view) que não foi visível na Fase 2.A.1 porque o BEFORE auditou apenas tabela, coluna, view, cron e código de aplicação — sem varrer pg_proc.

Aplicando a regra oficial da NexEngine:

> "Se Auditor AFTER retornar qualquer dependência → NÃO executar DROP. Continuar a migração."

**Fase 2.A.3 não é liberada nesta passagem.**
Aguardando aprovação para iniciar **Fase 2.A.2.b** (limpeza das 6 funções SQL + view) antes do DROP definitivo.
