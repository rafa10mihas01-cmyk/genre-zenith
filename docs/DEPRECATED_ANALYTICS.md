# Analytics — schema legado aposentado

Este documento registra o que foi **DEPRECATED** na reescrita do `/analytics`
para o motor de deals (snapshots + logs + playlist_brain).

> ⚠️ Nada foi apagado do banco. O front simplesmente parou de ler dessas fontes.
> Drops/cleanups serão feitos numa próxima fase, depois que confirmarmos zero leituras em produção por 1 release.

## Por que aposentar

A operação real hoje gira em torno de:

```
DEAL → SNAPSHOT diário → ENTREGA por playlist → DELTA
```

Mas o `/analytics` lia de um pipeline antigo (`CAMPAIGN → ALLOCATION`) que
não recebe mais escrita há semanas. Resultado: dashboards congelados,
"0% cumprimento" enquanto a operação real entregava milhares de plays.

## Fontes legadas (não usar mais no front)

| Objeto | Tipo | Última escrita observada | Substituto |
|---|---|---|---|
| `campaigns.total_delivered` | coluna | nunca atualizada pelo motor novo | `curator_deal_snapshots.plays` (delta no período) |
| `campaign_allocations` | tabela | **0 linhas** | `curator_deal_snapshots` agrupado por `(deal, playlist)` |
| `v_playlist_delivery_history` | view | depende de allocations | `curator_deal_snapshots` |
| `v_campaign_velocity` | view | depende de allocations | `computeDealPace()` em `src/lib/dealsAnalytics.ts` |
| `performance_insights` | tabela | **1 linha de ~28 dias atrás** | (removido do front; ingestão pode ficar até decisão de drop) |
| RPC `get_campaign_analytics_overview` | function | só lia das fontes acima | KPIs calculados no client a partir de snapshots |

## Onde ainda existem leituras

Após esta refatoração:

- `src/pages/Analytics.tsx` — só lê `curator_deals` + `curator_deal_snapshots` + `managed_playlists` (lookup de nome).
- `src/pages/Performance.tsx` — só lê `get_performance_dataset` + `genres`. Sem `performance_insights`.
- `src/pages/HeatmapEntregas.tsx` — só lê `curator_deal_logs`.
- `src/pages/MatrizPlaylists.tsx` — só lê `playlist_brain`.
- `src/pages/Benchmarks.tsx` — só lê `genre_benchmarks`.

## Próximos passos (fora deste PR)

1. Confirmar zero leituras nas fontes legadas em produção por 1 release.
2. Avaliar drop em ordem:
   - drop view `v_campaign_velocity`
   - drop view `v_playlist_delivery_history`
   - drop RPC `get_campaign_analytics_overview`
   - drop coluna `campaigns.total_delivered`
   - drop tabela `campaign_allocations` (se ninguém escreve)
3. Decidir se `performance_insights` vira histórico (ingestão mantida) ou aposenta junto.
