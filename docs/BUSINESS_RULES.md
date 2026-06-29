# NexEngine — Regras de negócio oficiais

## Delivery

**Delivery da campanha é a entrega acumulada atribuída desde a baseline.
O primeiro upload válido de cada playlist é sempre a baseline/ponto de partida
e não gera entrega. Dali pra frente, todo upload válido entra em sequência e
soma. Upload diário (`last_24h`/`last_day`) representa a entrega daquele envio
e entra integralmente. Leitura de janela móvel só entra pelo crescimento
positivo contra a leitura anterior.**

Fórmula canônica:

```
delta_playlist_leitura =
  0                                  se é o primeiro upload válido da playlist
  plays_7d                           se upload posterior é diário
  max(0, plays_7d − leitura_anterior) se leitura é janela móvel

delivery_playlist = SUM(delta_playlist_leitura)
delivery_campanha = SUM(delivery_playlist) das playlists atribuídas a
                    curador ou ecossistema (orgânico fora do total).
```

Detalhes técnicos em `docs/DELIVERY_ENGINE.md`. Implementação em
`fn_playlist_delivery_accumulated`.

## Baseline

- O primeiro upload válido de cada playlist por campanha é a baseline real.
- `campaign_playlist_collections.is_baseline=true` continua aceito, mas não pode
  excluir uploads posteriores.
- Sem marca explícita de baseline, a primeira leitura válida vira baseline e gera delta 0.

## Blindagem conceitual

- Proibido trocar o cálculo para High-Water Mark absoluto.
- Proibido deduplicar upload por `reference_date`.
- Proibido excluir upload válido por `status='superseded'`; esse status virou legado histórico.
- Proibido somar uploads em quarentena.
- Proibido usar mais de uma fonte matemática: a fonte única é
  `fn_playlist_delivery_accumulated`.

## Janela canônica

`campaigns.canonical_window_days` define qual `window_days` participa do
cálculo. Snapshots com `window_days` diferente são ignorados.

## Sequência de uploads

Não existe dedup por `(deal_id, reference_date)`. Se o operador envia três
planilhas no mesmo dia ou com a mesma data de referência, são três referências
sequenciais válidas e todas entram na soma depois da baseline. A ordem oficial
é a ordem de chegada (`label_spreadsheet_uploads.created_at`).

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
