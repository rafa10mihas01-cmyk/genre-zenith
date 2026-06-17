# AUDIT 4.A.1 — BEFORE (Otimização dos 4 maiores gargalos)

Data: 2026-06-17 · Modo: auditoria forense pré-refatoração.
Escopo: 4 itens do plano da Fase 4.A. Nenhuma alteração de arquitetura, contratos, Gateway, Match, Writer, Baseline ou Delivery.

---

## ITEM 1 — `vw_campaign_playlist_growth`

### Definição

CTE com 8 etapas:
1. `valid_collections` — JOIN `campaign_playlist_collections` LEFT `label_spreadsheet_uploads`, filtra `excluded=false` e uploads não quarentenados.
2. `baseline` — DISTINCT ON por (campaign_id, playlist_id) onde `is_baseline=true`.
3. `latest_meta` — DISTINCT ON da última leitura.
4. `campaigns_with_data` — DISTINCT campaign_id.
5. `acc` — CROSS JOIN LATERAL `fn_playlist_delivery_accumulated(campaign_id)` por campanha.
6. `firsts` — agregação `min(first_seen_at)`.
7. `eco` / `internal_owned` — JOIN com `managed_playlists` / `campaign_eco_allocations`.
8. `curator_reg` — DISTINCT ON em `curator_campaign_playlists`.

### EXPLAIN ANALYZE (campanha real, `0170d78a-...367053`)

```
Hash Left Join  (cost=3195..8684 rows=111284 width=240) (actual time=108..114 rows=716 loops=1)
  CTE valid_collections
    Seq Scan on campaign_playlist_collections c   (actual time=0.02..9.57 rows=25010)
    Filter: NOT COALESCE(excluded, false)
  Function Scan on fn_playlist_delivery_accumulated f  (actual time=37.6..37.7 rows=300)
  HashAggregate (CTE Scan on valid_collections)  rows=9879 (filter campaign_id) Rows Removed=15131
Planning Time: x  ·  Execution Time: 108–114 ms
```

### Diagnóstico

- **Por que demora:** CTE `valid_collections` referenciada 5 vezes → Postgres materializa o resultado **antes** do filtro `campaign_id=$1` no chamador (CTE é barreira porque tem `WHERE` complexo + reuso). Cada query escaneia 25 010 linhas e descarta 15 131 toda vez.
- **Parte mais cara:** o `fn_playlist_delivery_accumulated()` (37 ms LATERAL) + o HashAggregate sobre `valid_collections` (37 ms).
- **Join mais pesado:** Hash Left Join final entre `curator_reg` e o resultado consolidado.
- **Índice ignorado:** nenhum — o filtro `campaign_id` não desce dentro da CTE. Não é problema de índice, é problema de **plan barrier**.

### Tempo médio observado (psql, cold/warm)

| Run | Tempo |
|---|---|
| 1 | 260 ms |
| 2 | 233 ms |
| 3 | 237 ms |
| EXPLAIN execution | 108–114 ms |
| pg_stat_statements mean (24h) | 614–824 ms (6 padrões diferentes) |
| pg_stat_statements total acumulado | **~1,4 milhão de ms** |

### Callers (frontend + edge)

| Arquivo | Linha | Padrão |
|---|---|---|
| src/pages/CampanhaExecucao.tsx | 710 | `.from("vw_campaign_playlist_growth").select(...)` |
| src/pages/CampanhaDetalhe.tsx | 63 | idem |
| src/pages/PlanoCampanhaPublico.tsx | 351 | idem |
| src/components/campanhas/monitoramento/ExecucaoView.tsx | 140 | idem |
| src/components/campanhas/ExternalPackageEditor.tsx | 160 | idem |
| src/hooks/useCampaigns.ts | 83 | lista de campanhas (sem `campaign_id`) |
| src/hooks/useCuratorDeals.ts | 356 | por deal |
| src/hooks/useDealTodayPlaylistBreakdown.ts | 134 | por deal |
| supabase/functions/get-shared-campaign-plan/index.ts | 141 | público |
| supabase/functions/get-curator-deal-public/index.ts | 170, 341 | público |
| supabase/functions/get-client-campaign-public/index.ts | 444, 549 | público |

---

## ITEM 2 — Polling de `bot_heartbeats`

### Consumidores antes da refatoração (7 lugares)

| Componente | Frequência | Colunas | Padrão |
|---|---|---|---|
| `BotSaudeCard` | 60 s | `created_at, status, spotify_session_valid, message` | `setInterval` direto |
| `BotCollectionStatus` | 60 s | `created_at` | `setInterval` direto |
| `BaselineAwaitingBanner` | 60 s | `created_at, status` | `setInterval` (quando awaiting_baseline) |
| `CampaignDistributionConsole` | 60 s | `created_at, status, spotify_session_valid` | `setInterval` direto |
| `OperationalSummary` | sob demanda | `created_at` | parte de Promise.all com outras 5 queries |
| `AoVivoFeed` | realtime + bulk | `id, status, spotify_session_valid, message, created_at` (últimas 20) | INSERT realtime |
| `AoVivoPainel` | realtime + bulk | idem | INSERT realtime |

### Métricas pg_stat_statements (24 h)

| Padrão | Calls | Mean | Total |
|---|---|---|---|
| SELECT 3 cols + ORDER + LIMIT (latest) | 11 488 | 44 ms | **509 s** |
| SELECT created_at only + LIMIT | 6 280 | 41 ms | 261 s |
| SELECT 6 cols + ORDER + LIMIT | 3 703 | 37 ms | 137 s |
| **Soma** | **21 471** | — | **~907 s/dia** |

### Diagnóstico

- O **mesmo dado** (linha mais recente de `bot_heartbeats`) é buscado por 4–7 componentes diferentes simultaneamente.
- Cada um abre seu próprio `setInterval` de 60 s sem dedupe.
- React Query existe no projeto mas não estava sendo usado para esta query.

---

## ITEM 3 — Página `/campanhas/:id/execucao`

### Queries da página

`src/pages/CampanhaExecucao.tsx` (linhas 708-722) já usa `Promise.all` com 4 queries:

1. `vw_campaign_playlist_growth` (view #1) — full row da view
2. `campaign_playlist_collections` paginada (1000/page, full set)
3. `curator_campaign_playlists` (matched)
4. `campaign_eco_allocations` + JOIN managed_playlists

### Padrões pg_stat_statements identificados (view #1, mesma campanha)

| Padrão | Calls | Mean | Total |
|---|---|---|---|
| projeção completa `campaign_id=$1` | 1 028 | 614 ms | 632 s |
| `+ LIKE attributed_to` | 615 | 702 ms | 432 s |
| subset `playlist_id+plays` | 162 | 824 ms | 133 s |
| `campaign_id = ANY` | 161 | 778 ms | 125 s |
| subset `attributed_to+delta+delivery` | 161 | 535 ms | 86 s |

→ A página em si só faz **1 chamada** (linha 710). Os outros padrões vêm de outras telas (Campanha Detalhe, Plano Público, hooks de deals). A redundância está principalmente **entre páginas**, não dentro de uma só, mas o custo por chamada continua sendo o gargalo.

---

## ITEM 4 — `notifications WHERE read=false`

### Callers

| Arquivo | Linha | Query |
|---|---|---|
| src/pages/Home.tsx | 25 | `count exact, head=true, .eq('read', false)` |
| src/components/sistema/SaudeSistema.tsx | 68 | `count exact, head=true, .eq('read', false).eq('type','critical')` |
| src/components/sistema/SaudeSistema.tsx | 69 | `count exact, head=true, .eq('read', false).eq('type','warning')` |
| src/components/sistema/SaudeSistema.tsx | 70 | `select created_at .eq('read', false) order limit 1` |
| src/hooks/useNotifications.ts | — | já usa Realtime + cache React Query (sem polling) |

### pg_stat_statements

| Padrão | Calls | Mean | Total |
|---|---|---|---|
| `notifications WHERE read=$1` count head | 7 228 | 18 ms | 136 s |

### Diagnóstico

- Não existia índice parcial em `(user_id) WHERE read=false`.
- Cada count varria a tabela inteira (RLS aplica `user_id` por cima → seq scan filtrado).
- `useNotifications.ts` **já usa realtime**, só os contadores no Home/SaudeSistema fazem head:true count separado.

---

## CONSOLIDADO

| Item | Estado | Custo BEFORE |
|---|---|---|
| 1. View growth | sem RPC filtrada, sem cache | 614–824 ms/call · 1,4 M ms/dia |
| 2. Heartbeats polling | 7 consumidores, 21k+ calls/dia | ~907 s/dia |
| 3. Página Execução | 4 queries paralelas já em Promise.all | herda custo da view |
| 4. Notifications | sem índice parcial | 136 s/dia |
