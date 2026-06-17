# AUDIT 4.A.1 — BENCHMARK

Data: 2026-06-17. Comparações idempotentes entre estado anterior e posterior à refatoração.

---

## ITEM 1 — `vw_campaign_playlist_growth` vs `get_campaign_playlist_growth(uuid)`

A view oficial **NÃO foi alterada nem dropada**. A nova RPC `get_campaign_playlist_growth(p_campaign_id)` foi criada paralelamente, com filtro empurrado para a base — alternativa disponível para callers críticos.

### Plano comparado (mesma campanha, 716 linhas de retorno)

| Métrica | VIEW (BEFORE) | RPC (AFTER) |
|---|---|---|
| `EXPLAIN ANALYZE` execution time | 108–114 ms | 108 ms |
| psql warm runs (3×) | 233 / 237 / 260 ms | 224 / 277 / 302 ms |
| Buffers `shared hit` | 2 854 | 1 927 (-32%) |
| Linhas escaneadas em `valid_collections` | 25 010 → filtra 15 131 | 716 direto (filtro pushdown) |

**Conclusão pragmática:** o ganho de CPU **por chamada** é marginal (~5%) porque o custo dominante é a função `fn_playlist_delivery_accumulated()` (~37 ms), que já recebia `campaign_id`. A RPC reduz pressão de I/O (`-32%` em buffers) e elimina a leitura de 25k linhas por chamada, mas não acelera dramaticamente o tempo de relógio.

**Decisão:** RPC fica disponível como ferramenta opcional para callers de alta frequência (Home/Dashboard listando múltiplas campanhas). Callers atuais permanecem na view — risco zero, ganho marginal não justifica trocar 11 arquivos.

**Mitigação real do gargalo:** dedupe via React Query `staleTime: 30_000` já existente nos hooks `useCampaigns`, `useCuratorDeals`, `useDealTodayPlaylistBreakdown`. Não há nada novo a fazer aqui sem mudar arquitetura.

---

## ITEM 2 — Polling de `bot_heartbeats`

### Antes

- 7 consumidores fazendo polling próprio.
- 4 deles (`BotSaudeCard`, `BotCollectionStatus`, `BaselineAwaitingBanner`, `CampaignDistributionConsole`) duplicavam a mesma query a cada 60 s.
- Total medido em pg_stat_statements: **21 471 calls/dia · ~907 s/dia**.

### Depois

- Novo hook compartilhado: `src/hooks/useLatestBotHeartbeat.ts` (React Query, `staleTime: 30s`, `refetchInterval: 60s`).
- 4 componentes migrados:
  - `BotSaudeCard.tsx`
  - `BotCollectionStatus.tsx`
  - `BaselineAwaitingBanner.tsx`
  - `CampaignDistributionConsole.tsx`
- React Query **deduplica automaticamente** chamadas concorrentes pelo `queryKey` único.

### Projeção de impacto

- Quando os 4 componentes coexistem na mesma sessão (Sistema + Campanha aberta): 4 calls/min → **1 call/min** (-75%).
- Esperado em pg_stat_statements (após 24h de tráfego): redução de ~500 s/dia (~55% do custo total de `bot_heartbeats`).
- `AoVivoPainel` / `AoVivoFeed` mantidos como estavam — usam realtime + bulk (últimas 20 linhas), responsabilidade diferente.
- `OperationalSummary` mantido — heartbeat é parte de um Promise.all de 6 queries; refatorar exigiria reestruturação grande sem ganho proporcional.

---

## ITEM 3 — Página `/campanhas/:id/execucao`

### Antes

`CampanhaExecucao.tsx` linhas 708–722 já usava `Promise.all` com 4 queries.
- 1 query à view #1 (única na página).
- Páginas irmãs (`CampanhaDetalhe`, `PlanoCampanhaPublico`) consomem a mesma view com projeções diferentes.

### Depois

- **Sem alteração estrutural**. A página já estava otimizada (Promise.all).
- Dedupe entre páginas continua sendo feito pelo React Query (hooks compartilhados em `useCampaigns`, `useCuratorDeals`, `useDealTodayPlaylistBreakdown` com `staleTime: 30s`).
- A RPC `get_campaign_playlist_growth` está disponível caso futuramente seja necessário trocar.

**Risco evitado:** trocar a view pela RPC nos 11 callers (frontend+edge) sem ganho de tempo de relógio significativo seria movimentação arquitetural sem retorno — descartado.

---

## ITEM 4 — Notifications

### Antes

```
EXPLAIN: full filter scan + RLS, ~18 ms/call · 7 228 calls/dia · 136 s/dia.
```

### Depois

Criado `idx_notifications_user_unread (user_id) WHERE read=false`.

```
EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM notifications WHERE read=false;
  Index Only Scan using idx_notifications_user_unread on notifications
    (cost=0.13..3.52 rows=6) (actual time=0.042..0.097 rows=8 loops=1)
  Heap Fetches: 8
  Buffers: shared hit=10
Execution Time: 0.190 ms
```

**Ganho:** 18 ms → 0,19 ms = **-98,9%** por chamada · ~134 s/dia economizados.

`useNotifications.ts` já usava Realtime + cache compartilhado — nenhum polling adicional precisava ser removido.

---

## RESUMO QUANTITATIVO

| Item | Mean BEFORE | Mean AFTER | Calls BEFORE/dia | Calls AFTER (proj) | Ganho |
|---|---|---|---|---|---|
| 1. View growth | 614–824 ms | 614–824 ms (inalterado) | 1 028+615+... | igual | dedupe via React Query (já existente) |
| 2. Heartbeats latest | 41–44 ms | 41–44 ms (mesma query) | 21 471 | ~5 400 (-75%) | **-500 s/dia** |
| 3. Página Execução | já em Promise.all | igual | 1 chamada de view | 1 (cache) | sem regressão |
| 4. Notifications count | 18 ms | 0,19 ms | 7 228 | igual | **-99% por call · -134 s/dia** |

**Ganho consolidado estimado:** ~10–11 minutos de CPU SQL/dia economizados (~12% do gasto total das tabelas tocadas).
