# Delivery Engine — Modelo Oficial (Entrega acumulada diária)

> **Definição oficial NexEngine:**
> Delivery da campanha = soma, por playlist, da entrega atribuída desde a
> baseline. O primeiro upload válido da playlist é a baseline e não entrega.
> Todo upload válido depois dele soma. Upload diário (`last_24h`/`last_day`)
> entra integralmente. Janela móvel entra apenas pelo crescimento positivo
> contra a leitura anterior.

## Por que este modelo

Os arquivos diários importados como `last_24h`/`last_day` já representam a
entrega daquele envio. Por isso, todos os uploads posteriores à baseline entram
integralmente no acumulado, mesmo quando têm a mesma `reference_date`.

Quando a leitura é de janela móvel (`plays_7d`), ela não é contador acumulado.
Nesse caso, quedas não removem delivery e só o crescimento positivo contra a
leitura anterior gera incremento.

## Estados de uma playlist na campanha

| Estado | Origem |
|---|---|
| `baseline_plays` | `plays_7d` do primeiro upload válido da playlist; baseline gera delta 0. |
| `delivery_accumulated` | `SUM(delta_pos)` das leituras válidas da playlist. |
| `current_reading` | Último `plays_7d` por ordem de chegada (informativo, **não** é delivery). |
| `last_import_delta` | Delta da última leitura: valor integral se diária; crescimento positivo se janela móvel. |

## Filtros aplicados (todos no `fn_playlist_delivery_accumulated`)

- `campaign_playlist_collections.excluded = false`
- `label_spreadsheet_uploads.quarantined_at IS NULL`
- `window_days = campaigns.canonical_window_days`
- Playlist está em `curator_campaign_playlists` (não excluída), em
  `campaign_eco_allocations`, **ou** marcada `is_baseline=true`.
- Não há dedup por `reference_date`; `status='superseded'` é legado histórico e
  não remove upload do cálculo.

## Fórmula canônica

```text
delta_pos =
  0                                  se é a primeira leitura válida da playlist
  0                                  se is_baseline = true
  plays_7d                           se upload posterior é last_24h/last_day
  max(0, plays_7d − prev_plays_7d)    nos demais casos
```

## Ordem oficial

A sequência de cálculo é `label_spreadsheet_uploads.created_at`, com
`campaign_playlist_collections.captured_at` apenas como desempate. A
`reference_date` é somente rótulo visual/auditável da planilha e nunca decide
dedup, baseline ou soma.

## Validação Carnívoro

Após a correção da regressão HWM absoluto, Carnívoro voltou para:

| Métrica | Valor |
|---|---:|
| Curadores | 424.310 |
| Ecossistema | 149.990 |
| Total atribuído | **574.300** |

## Componentes derivados (todos consomem a fonte única)

- `fn_campaign_delivery_accumulated` — agrega curador/eco/orgânico
- `fn_curator_delivery_accumulated` — agrega por curador
- `get_campaign_playlist_growth` — linha por playlist
- `vw_campaign_playlist_growth` — view multi-campanha
- `vw_campaign_playlist_delivery_origin` — anota origem (baseline_original / post_baseline)
- `recompute_campaign_total_delivered` — atualiza
  `campaigns.total_delivered` e `curator_deals.reconciled_total_plays`
- Triggers `sync_campaign_total_delivered*` em
  `curator_deal_snapshots` e `campaign_eco_snapshots`

`fn_deal_delivery_accumulated` opera em `curator_deal_snapshots` (contador
cumulativo, **não** janela móvel) e permanece fora desta regra de upload
diário/plays_7d.

## Proibições explícitas

- Proibido criar feature flag, ramo alternativo ou "modelo legado".
- Proibido trocar o cálculo para High-Water Mark absoluto.
- Proibido recalcular delivery no frontend.
- Proibido subtrair delivery quando `plays_7d` cair.
- Proibido deduplicar planilha por `reference_date`.
- Proibido excluir upload válido porque está `superseded`; supersede é legado.
- Portal Cliente, Portal Curador, Dashboard, KPIs, Financeiro, PDFs,
  Heatmaps, Analytics e APIs públicas **sempre** consomem essas funções
  acima — não recalculam delivery localmente.
