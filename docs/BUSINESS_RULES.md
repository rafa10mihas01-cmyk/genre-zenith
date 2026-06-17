# NexEngine — Regras de negócio oficiais

## Delivery

**Delivery da campanha é definido como o maior crescimento histórico
(High-Water Mark) de cada playlist desde a baseline. Oscilações negativas da
janela móvel do Spotify nunca reduzem a entrega já conquistada.**

Fórmula canônica:

```
delivery_playlist = GREATEST(0, MAX(plays_7d desde baseline) − baseline_plays)
delivery_campanha = SUM(delivery_playlist) das playlists atribuídas a
                    curador ou ecossistema (orgânico fora do total).
```

Detalhes técnicos em `docs/DELIVERY_ENGINE.md`. Implementação em
`fn_playlist_delivery_accumulated`.

## Baseline

- 1 baseline por playlist por campanha (`campaign_playlist_collections.is_baseline=true`).
- Quando múltiplas linhas marcadas, vale a mais recente por `reference_date`.
- Sem baseline marcada → baseline efetiva = 0 (delivery = HWM).

## Janela canônica

`campaigns.canonical_window_days` define qual `window_days` participa do
cálculo. Snapshots com `window_days` diferente são ignorados.

## Dedup de uploads

Apenas 1 upload ativo por `(deal_id, reference_date)`. Uploads anteriores
do mesmo dia são automaticamente marcados `status='superseded'` por trigger
e excluídos de todo cálculo. Ver `docs/audits/UPLOAD_DEDUP_BENCHMARK.md`.

## Atribuição

| Bucket | Critério |
|---|---|
| `ecosystem` | Playlist em `campaign_eco_allocations`. |
| `curator:<id>` | Playlist em `curator_campaign_playlists` (status `matched`/`pending_match`/`baseline_conflict`, não excluída). |
| `organic` | Demais. **Não** entra em `total_delivered` da campanha. |

## Cache

`campaigns.total_delivered` e `curator_deals.reconciled_total_plays` são
cache; fonte da verdade é `fn_campaign_delivery_accumulated` /
`fn_curator_delivery_accumulated`. `recompute_campaign_total_delivered`
sincroniza; triggers reagem a mudanças em snapshots e alocações.
