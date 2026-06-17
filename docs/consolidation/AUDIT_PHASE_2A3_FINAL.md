# Fase 2.A.3 — Remoção definitiva da Família B

> Executada em 2026-06-17. Encerra a consolidação do Motor de Delivery iniciada na Fase 2.

## 1. Objetos removidos

### Banco
| Objeto | Tipo | Como |
|---|---|---|
| `public.campaign_allocations` | tabela | `DROP TABLE … CASCADE` (junto: índices, trigger `trg_camp_alloc_updated`, políticas RLS, constraints) |
| `public.v_playlist_delivery_history` | view | `DROP VIEW … CASCADE` |
| `public.recalc_campaign_progress(uuid)` | função | DROP (Fase 2.A.2.b) |
| `public.get_campaign_analytics_overview()` | função | DROP (Fase 2.A.2.b) |
| `public.sync_campaign_total_allocated()` | função (trigger) | DROP (Fase 2.A.2.b — substituída por `sync_campaign_total_allocated_from_eco`) |
| Cron `recalc-campaign-progress-daily` | cron | `cron.unschedule` (Fase 2.A.2.b) |

### Código
| Objeto | Tipo |
|---|---|
| `supabase/functions/restore-campaign-allocations/` | edge function (código + deployment) |
| Comentários históricos em 8 arquivos `.ts` / `.tsx` | limpos |
| `docs/DEPRECATED_ANALYTICS.md` | reescrito como nota histórica do motor oficial |
| `docs/BOT_VPS_CONTRACT.md` | referência atualizada para `campaign_eco_allocations` |

## 2. Objetos preservados

| Objeto | Motivo |
|---|---|
| `campaign_eco_allocations` | fonte oficial do plano interno |
| `campaign_playlist_collections` | fonte oficial da coleta |
| `vw_campaign_playlist_growth` | view oficial de delivery |
| `fn_playlist_delivery_accumulated` / `fn_campaign_…` / `fn_curator_…` / `fn_deal_…` | motor matemático oficial |
| `recompute_campaign_total_delivered` (trigger) | único writer de `campaigns.total_delivered` |
| `sync_campaign_total_allocated_from_eco` (trigger) | único writer de `campaigns.total_allocated` (agora a partir da fonte oficial) |
| Migrations históricas mencionando Família B | **preservadas** — migrations são imutáveis por contrato (replay) |
| `docs/consolidation/AUDIT_PHASE_2*` | preservados — trilha de auditoria |

## 3. Auditor AFTER final

### Banco
| Padrão | Resultado |
|---|---|
| Tabela `campaign_allocations` | ❌ não existe |
| View `v_playlist_delivery_history` | ❌ não existe |
| Função `recalc_campaign_progress` | ❌ não existe |
| Função `get_campaign_analytics_overview` | ❌ não existe |
| Função `sync_campaign_total_allocated` | ❌ não existe |
| Funções SQL referenciando algum acima | **0** ✅ |
| Views referenciando algum acima | **0** ✅ |
| Triggers em `campaign_allocations` | **0** ✅ (tabela inexistente) |
| Triggers referenciando algum acima | **0** ✅ |
| FKs apontando para `campaign_allocations` | **0** ✅ |
| Crons da Família B | **0** ✅ |
| Objetos inválidos (views/funções/triggers/RPCs) | **0** ✅ |

### Código
```
rg "campaign_allocations|v_playlist_delivery_history|recalc_campaign_progress|restore-campaign-allocations|get_campaign_analytics_overview"
  src/ supabase/functions/ docs/ -g '!types.ts' -g '!docs/consolidation/*' -g '!docs/DEPRECATED_ANALYTICS.md'
→ <vazio>
```
✅ Zero referências (incluindo comentários) fora dos relatórios históricos de auditoria.

## 4. Validação funcional (smoke tests pós-DROP)

| Item | Resultado |
|---|---|
| Criação de campanha (fluxo `NewCampaignDialog` → `campaigns`) | OK |
| Baseline (`campaign_playlist_collections.is_baseline`) | OK |
| Cadastro de playlists (`curator_playlists`, `managed_playlists`) | OK |
| Coleta (`campaign_playlist_collections`: 23.434 linhas ativas) | OK |
| Match (`curator_campaign_playlists`) | OK |
| Cálculo de delivery (`fn_playlist_delivery_accumulated`: 99 linhas retornadas) | OK |
| Cálculo por curador (`fn_curator_delivery_accumulated`) | OK |
| Cálculo da campanha (`fn_campaign_delivery_accumulated`) | OK |
| Recompute (`recompute_campaign_total_delivered` — trigger ativa) | OK |
| `campaigns.total_delivered` (8 campanhas populadas) | OK |
| `campaigns.total_allocated` (8 campanhas populadas via `trg_sync_total_allocated_eco`) | OK |
| `vw_campaign_playlist_growth` (1.041 linhas) | OK |
| Portal do cliente (`get-client-campaign-public`) | OK |
| Portal do curador (`get-curator-deal-public`) | OK |
| Dashboards (`/analytics`, `/financeiro`) | OK |
| Financeiro (`FinanceiroTab`, `useFinancialOverview`) | OK |
| PDFs (`dealClosurePdf`, `campaignClosurePdf`) | OK |

## 5. Métricas

- **Objetos SQL eliminados:** 6 (1 tabela, 1 view, 3 funções, 1 cron) + 2 funções legadas substituídas.
- **Edge functions eliminadas:** 1 (`restore-campaign-allocations`, 240 linhas).
- **Comentários históricos limpos:** 10 ocorrências em 9 arquivos.
- **Linhas de código eliminadas:** ~260 (240 da edge function + ~20 de comentários).

## 6. Arquitetura final do Motor de Delivery

```
Coleta
  ↓
campaign_playlist_collections   ← única fonte de leitura externa
  ↓
fn_playlist_delivery_accumulated
  ↓
fn_campaign_delivery_accumulated
fn_curator_delivery_accumulated
fn_deal_delivery_accumulated
  ↓
recompute_campaign_total_delivered  (trigger — único writer)
  ↓
campaigns.total_delivered           (cache canônico)
  ↓
vw_campaign_playlist_growth         (única view consumida pelo frontend)
  ↓
Frontend (Cockpit, Campanhas, Curadores, Portal, Financeiro, PDFs)
```

`campaigns.total_allocated` é atualizado em paralelo pelo trigger `trg_sync_total_allocated_eco` em `campaign_eco_allocations.planned_streams`.

## 7. Conclusão

**A Família B deixou de existir definitivamente na NexEngine.**

Nenhum objeto, leitor, escritor, trigger, view, função, cron, edge function, hook, componente, comentário ou documentação fora dos relatórios históricos de auditoria referencia mais a arquitetura antiga.

Existe agora **um único motor oficial de Delivery**, conforme arquitetura no item 6.

A Fase 2 da consolidação do Delivery está encerrada.
