# FASE 5.C — Correção definitiva da regressão de delivery

## Causa raiz

A migração `20260617222427_4ad12c15-3b70-4068-903a-79b487b2d3b5.sql`
trocou o motor de delivery para High-Water Mark absoluto:

```sql
GREATEST(0, MAX(plays_7d) - baseline_plays)
```

Esse modelo ignorou entregas diárias válidas de 14/06 e 15/06 quando elas não
superavam o maior pico histórico da playlist. Por isso Carnívoro caiu de
574.300 para 80.973.

## Correção aplicada

Migração: `20260617224950_fe7f53b4-8c6a-4bf5-8bd7-449caf04c81f.sql`.

Função corrigida: `public.fn_playlist_delivery_accumulated(uuid)`.

Regra blindada:

```text
baseline -> delta 0
upload diário -> entra integralmente
janela móvel -> max(0, leitura atual - leitura anterior)
superseded/quarentena/excluído -> fora
```

## Validação Carnívoro

Campanha: `0170d78a-97f1-41f7-99eb-a5b31c367053`.

| Métrica | Valor |
|---|---:|
| Curadores | 424.310 |
| Ecossistema | 149.990 |
| Total atribuído | **574.300** |
| Cache `campaigns.total_delivered` | **574.300** |

## Garantia

- `fn_campaign_delivery_accumulated` continua agregando somente a fonte oficial.
- `fn_curator_delivery_accumulated` continua derivada da mesma fonte.
- `vw_campaign_playlist_growth` e `get_campaign_playlist_growth` continuam
  consumindo `fn_playlist_delivery_accumulated`.
- Não houve alteração em Gateway, Match, Writer, Baseline, APIs ou Frontend.
- A documentação oficial agora proíbe High-Water Mark absoluto como regra de
  delivery.