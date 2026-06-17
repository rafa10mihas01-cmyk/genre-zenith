# Fase 2.A.2.b — Auditor AFTER

> Gerado em 2026-06-17, após migrar as 6 funções SQL e a trigger para a arquitetura oficial e dropar o motor legado `recalc_campaign_progress` + cron `recalc-campaign-progress-daily`.

## Resumo das ações executadas

| # | Alvo | Ação | Fonte oficial agora utilizada |
|---|---|---|---|
| 1 | `get_campaign_analytics_overview` | **DROP** (órfã — confirmada) | — |
| 2 | `client_request_adjustment` | Reescrita | `campaign_eco_allocations` + `managed_playlists` |
| 3 | `suggest_campaign_playlists` | Reescrita | `campaign_eco_allocations` (exclusão) + `vw_campaign_playlist_growth` + `campaign_eco_allocations.planned_streams` (fulfillment) |
| 4 | `evaluate_playlist` | Reescrita | `vw_campaign_playlist_growth` + `campaign_eco_allocations.planned_streams` |
| 5 | `evaluate_playlists_batch` | Sem mudança — herda automaticamente o novo `evaluate_playlist` | — |
| 6 | `recalc_playlist_scores` | Bloco `agg_history` reescrito | `vw_campaign_playlist_growth` + `campaign_eco_allocations` |
| 7 | `sync_campaign_total_allocated` | **Substituída** por `sync_campaign_total_allocated_from_eco`, trigger migrada de `campaign_allocations` para `campaign_eco_allocations` | `campaign_eco_allocations.planned_streams` |
| 8 | `recalc_campaign_progress` | **DROP** (último consumidor de `campaign_allocations`) | — |
| 9 | Cron `recalc-campaign-progress-daily` | **unschedule** | — |
| 10 | `campaigns.total_allocated` | Backfill único realinhando todas as campanhas pela nova fonte | — |

## Auditor AFTER — varredura completa

### Funções SQL
| Padrão | Quantidade |
|---|---|
| `campaign_allocations` | **0** ✅ |
| `v_playlist_delivery_history` | **0** ✅ |
| `recalc_campaign_progress` | **0** ✅ |

### Views
| Padrão | Quantidade |
|---|---|
| `campaign_allocations` | **0** ✅ |
| `v_playlist_delivery_history` | **0** ✅ |

### Triggers
| Padrão | Quantidade |
|---|---|
| Action statement referenciando Família B | **0** ✅ |
| Triggers em `campaign_allocations` | 1 — apenas `trg_camp_alloc_updated` (genérico `tg_set_updated_at`, sai junto com a tabela) |

### Cron jobs
| Padrão | Quantidade |
|---|---|
| `recalc-campaign-progress-daily` | **0** ✅ (cancelado) |

### FKs apontando para `campaign_allocations`
**0** ✅

### Código (frontend / hooks / edge functions)
| Padrão | Resultado |
|---|---|
| `campaign_allocations` / `v_playlist_delivery_history` / `recalc_campaign_progress` / `get_campaign_analytics_overview` | Apenas **comentários históricos** ("aposentada na Fase 2.A.2") — zero leitura/escrita ativa |

## Pendências reais — apenas o objeto físico

- **Tabela `campaign_allocations`** — sem leitores, sem escritores SQL, sem FKs entrando. A trigger remanescente é o `updated_at` genérico, que cai junto com o `DROP TABLE`.
- **View `v_playlist_delivery_history`** — sem consumidores SQL.

## Conclusão

| Critério | Status |
|---|---|
| 0 funções SQL referenciando Família B | ✅ |
| 0 triggers referenciando Família B | ✅ |
| 0 procedures | ✅ |
| 0 views consumidoras | ✅ |
| 0 crons | ✅ |
| 0 leituras/escritas em código | ✅ (apenas comentários) |

**Família B oficialmente liberada para a Fase 2.A.3 (DROP definitivo de `campaign_allocations`, `v_playlist_delivery_history` e remoção dos comentários históricos).**
