# Delivery Engine — Modelo Oficial (High-Water Mark)

> **Definição oficial NexEngine:**
> Delivery da campanha = soma, por playlist, de
> `GREATEST(0, MAX(plays_7d desde a baseline) − baseline_plays_7d)`.
> Oscilações negativas da janela móvel do Spotify **nunca reduzem** a entrega
> já conquistada. Recuperações **abaixo** do recorde **não** geram nova entrega.

## Por que High-Water Mark e não soma de deltas positivos

`plays_7d` é uma **janela móvel** de 7 dias reportada pelo Spotify for Artists.
Não é um contador acumulado. Quando a janela se desloca após um pico de fim de
semana, o valor cai mesmo sem perda de entrega real.

O modelo antigo somava todos os deltas positivos. Isso recontava entrega
sempre que a janela caía e voltava a subir — inflando o delivery
artificialmente. HWM elimina essa duplicidade: cada incremento só conta
quando supera o teto histórico anterior.

## Estados de uma playlist na campanha

| Estado | Origem |
|---|---|
| `baseline_plays` | `plays_7d` da linha `is_baseline=true` da playlist (a mais recente, se múltiplas). 0 quando não há baseline marcada. |
| `hwm` | `MAX(plays_7d)` entre todos os snapshots válidos da playlist desde o início da campanha. |
| `delivery_accumulated` | `GREATEST(0, hwm − baseline_plays)` |
| `current_reading` | Último `plays_7d` por `reference_date` (informativo, **não** é delivery). |
| `last_import_delta` | `GREATEST(0, last_plays_7d − MAX(plays_7d até a leitura anterior))`. Quanto a última leitura aportou ao HWM. |

## Filtros aplicados (todos no `fn_playlist_delivery_accumulated`)

- `campaign_playlist_collections.excluded = false`
- `label_spreadsheet_uploads.quarantined_at IS NULL`
- `label_spreadsheet_uploads.status <> 'superseded'`
- `window_days = campaigns.canonical_window_days`
- Playlist está em `curator_campaign_playlists` (não excluída), em
  `campaign_eco_allocations`, **ou** marcada `is_baseline=true`.

## Casos de validação obrigatórios

| Caso | Série após baseline=0 | Delivery esperado |
|---|---|---:|
| 1 | 1000, 1800, 1500, 3000, 2500, 7000 | **7000** |
| 2 | 1000, 800, 900, 950, 980 | **1000** |
| 3 | 1000, 800, 1200 | **1200** |
| 4 (usuário) | 1000, 1800, 11800, 31800 | **31800** |

Todos passam — ver `docs/audits/HWM_VALIDATION.md`.

## Componentes derivados (todos consomem HWM via fonte única)

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
cumulativo, **não** janela móvel) e já usa `GREATEST(latest − baseline, 0)`,
o que é HWM-equivalente para séries monotônicas.

## Proibições explícitas

- Proibido criar feature flag, ramo alternativo ou "modelo legado".
- Proibido somar deltas positivos consecutivos em qualquer view, função ou
  código de aplicação que envolva `plays_7d`.
- Proibido subtrair delivery quando `plays_7d` cair.
- Portal Cliente, Portal Curador, Dashboard, KPIs, Financeiro, PDFs,
  Heatmaps, Analytics e APIs públicas **sempre** consomem essas funções
  acima — não recalculam delivery localmente.
