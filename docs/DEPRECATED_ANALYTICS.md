# Analytics — schema legado aposentado

> **Status: removido definitivamente na Fase 2.A.3 (2026-06-17).**
> Esta página fica como nota histórica.

Na reescrita do `/analytics` para o motor de deals (snapshots + logs + playlist_brain), o front parou de ler do pipeline antigo `CAMPAIGN → ALLOCATION`. A Fase 2 da consolidação do Delivery (2.A.1 → 2.A.3) eliminou todos os objetos legados.

## Objetos removidos (não existem mais)

| Objeto | Tipo | Removido em |
|---|---|---|
| `campaign_allocations` | tabela | Fase 2.A.3 |
| `campaign_allocations.delivered_plays` | coluna | Fase 2.A.3 (junto com a tabela) |
| `v_playlist_delivery_history` | view | Fase 2.A.3 |
| `v_campaign_velocity` | view | já removida em fase anterior |
| `recalc_campaign_progress` | função | Fase 2.A.2.b |
| Cron `recalc-campaign-progress-daily` | cron | Fase 2.A.2.b |
| `get_campaign_analytics_overview` | função | Fase 2.A.2.b |
| Edge function `restore-campaign-allocations` | edge function | Fase 2.A.3 |

## Motor oficial único de Delivery

```
Coleta
  ↓
campaign_playlist_collections
  ↓
fn_playlist_delivery_accumulated
  ↓
fn_campaign_delivery_accumulated / fn_curator_delivery_accumulated / fn_deal_delivery_accumulated
  ↓
recompute_campaign_total_delivered (trigger)
  ↓
campaigns.total_delivered
  ↓
vw_campaign_playlist_growth
  ↓
Frontend
```

Nenhum outro caminho calcula ou persiste Delivery.
