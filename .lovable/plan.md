
# Reescrita do módulo Analytics — motor de deals

Plano executável para reescrever a área `/analytics` lendo direto do motor vivo (`curator_deals` / `curator_deal_snapshots` / `curator_deal_logs` / `playlist_brain` / `genre_benchmarks`), aposentando as fontes legadas (`campaigns.total_delivered`, `campaign_allocations`, `v_playlist_delivery_history`, `performance_insights`, `v_campaign_velocity`, RPC `get_campaign_analytics_overview`).

---

## 1. Mapa dos componentes atuais

Auditoria por arquivo + fonte de dados + estado real do pipeline:

| Página / componente | Fonte de dados | Estado | Decisão |
|---|---|---|---|
| `pages/Analytics.tsx` — KPIs Prometido/Entregue/Cumprimento + gráfico stack | RPC `get_campaign_analytics_overview` (lê `campaigns.total_delivered`) | **MORTO** (campanhas não recebem update) | Reescrever |
| `pages/Analytics.tsx` — "Performance por playlist" Top/Bottom 10 | mesmo overview RPC | **MORTO** | Reescrever |
| `pages/Analytics.tsx` — "Velocidade em execução" | view `v_campaign_velocity` (lê allocations + campaigns) | **MORTO** (allocations=0) | Substituir por velocidade de deals |
| `pages/Analytics.tsx` — Heatmap embedado | `curator_deal_logs` | **VIVO** | Mantido |
| `pages/Performance.tsx` — KPIs + insights | RPC `get_performance_dataset` + `performance_insights` | **PARCIAL** — dataset roda; insights congelados há 28 dias | Manter dataset, dropar painel de insights congelado |
| `pages/MatrizPlaylists.tsx` | `playlist_brain` (227 linhas, fresh) | **VIVO** | Mantido |
| `pages/HeatmapEntregas.tsx` | `curator_deal_logs` | **VIVO** | Mantido |
| `pages/Benchmarks.tsx` | `genre_benchmarks` | **VIVO** | Mantido |
| `pages/Valuation.tsx` | RPC `evaluate_playlist_by_url` | **VIVO** | Mantido |
| `AnalyticsTabs.tsx` | nav | — | Renomear "Campanhas"→"Deals" |

Pulse do banco (confirma a auditoria):
- `curator_deal_snapshots`: **4 735 linhas, última 2026-05-20** ✅
- `curator_deal_logs`: **62 linhas, última 2026-05-20** ✅
- `curator_deals`: 7 linhas ✅
- `playlist_brain`: 227, atualizada hoje ✅
- `campaign_allocations`: **0 linhas** ❌
- `performance_insights`: **1 linha, 28 dias atrás** ❌

---

## 2. Nova arquitetura semântica

```text
DEAL (artista, janela, meta) 
   └─ SNAPSHOT diário (plays, followers, delta)
        └─ LOG de execução (timestamp, playlist, ação)
              └─ PLAYLIST_BRAIN (saúde, score)
```

O Analytics passa a responder 4 perguntas, nessa ordem:

1. **Deals** — quanto está rodando AGORA, no ritmo certo?
2. **Playlists** — quais entregam de verdade?
3. **Mercado** — como meus gêneros se comparam?
4. **Avaliar** — quanto vale uma playlist?

---

## 3. Nova estrutura de abas

| Aba atual | Aba nova | Conteúdo |
|---|---|---|
| Campanhas | **Deals** (`/analytics`) | KPIs reais + ritmo + heatmap |
| Playlists | **Playlists** (`/performance`) | Dataset live + Matriz (sub-aba) |
| Mercado | **Mercado** (`/benchmarks`) | inalterado |
| Avaliar | **Avaliar** (`/valuation`) | inalterado |

---

## 4. Aba "Deals" — reescrita completa de `Analytics.tsx`

Fonte única: `curator_deal_snapshots` + `curator_deal_logs` + `curator_deals`.

### KPIs (4 cards)
Todos calculados em JS sobre os últimos N dias de snapshots:

- **Deals ativos** = `curator_deals where status='active'`
- **Plays entregues (7d)** = soma de `(snapshot.plays - snapshot_anterior.plays)` por deal, janela 7d
- **Delta médio diário** = média de delta diário entre snapshots consecutivos
- **Custo por play real** = soma `deal.amount` / soma de plays entregues no período

### Seção "Ritmo dos deals ativos"
Substitui "Velocidade":
- Para cada deal ativo: plays prometidos vs entregue acumulado, plays/dia médio (últimos 3 snapshots), pace ratio (real/esperado), status (Adiantado / No ritmo / Lenta / Crítica).

### Seção "Entregas por dia (30d)"
LineChart: agrega `curator_deal_logs` por dia → conta entregas. Substitui o BarChart stacked de status de campanha.

### Seção "Top playlists entregando (30d)"
Agrega `curator_deal_logs` por `playlist_id` na janela → top 10 com plays entregues, deals atendidos, último log.

### Seção "Heatmap de entregas"
Mantido, já vivo.

---

## 5. Aba "Playlists" — limpeza de `Performance.tsx`

- Remover o card de `performance_insights` (congelado).
- Manter `get_performance_dataset` (vivo) — é apenas leitura de `playlist_brain` + agregados.
- Adicionar banner de "última atualização" lendo `max(updated_at)` do `playlist_brain`.
- `MatrizPlaylists.tsx` continua igual.

---

## 6. Marcação de legado (sem deletar)

Criar `docs/DEPRECATED_ANALYTICS.md` listando:
- `campaign_allocations` (tabela)
- `v_playlist_delivery_history` (view)
- `v_campaign_velocity` (view)
- `performance_insights` (tabela — só painel removido; ingestão fica)
- `campaigns.total_delivered` (coluna)
- RPC `get_campaign_analytics_overview`

E adicionar comentário `// @deprecated` em cada import remanescente. Nenhum DROP/DELETE neste PR.

---

## 7. Arquivos tocados

**Reescritos:**
- `src/pages/Analytics.tsx` — nova versão lendo snapshots/logs/deals
- `src/pages/Performance.tsx` — remover bloco performance_insights

**Atualizados:**
- `src/components/AnalyticsTabs.tsx` — label "Campanhas" → "Deals"
- `src/content/pageManuals.ts` — atualizar manual "analytics" com nova semântica

**Novos:**
- `src/lib/dealsAnalytics.ts` — helpers puros: `computeDealVelocity`, `aggregateDeliveriesByDay`, `topPlaylistsFromLogs`, `realCostPerPlay`
- `docs/DEPRECATED_ANALYTICS.md`

**Não tocados:**
- `Benchmarks.tsx`, `Valuation.tsx`, `MatrizPlaylists.tsx`, `HeatmapEntregas.tsx`, backend, edge functions, ingestão de snapshots.

---

## 8. Detalhes técnicos

### Queries principais (client-side, via supabase-js)

```ts
// snapshots da janela (com deal)
supabase
  .from("curator_deal_snapshots")
  .select("deal_id, captured_at, plays, followers, curator_deals!inner(id, status, amount, plays_promised, artist_name, started_at)")
  .gte("captured_at", since30d)
  .order("captured_at", { ascending: true });

// logs da janela (para entregas/dia, heatmap, top playlists)
supabase
  .from("curator_deal_logs")
  .select("id, created_at, deal_id, playlist_id, playlist_name, plays_added")
  .gte("created_at", since30d);

// deals ativos com último snapshot
supabase
  .from("curator_deals")
  .select("*, snapshots:curator_deal_snapshots(plays, captured_at)")
  .eq("status", "active");
```

### Cálculos puros (em `dealsAnalytics.ts`)
- **delta diário por deal**: ordenar snapshots, subtrair plays consecutivos, dividir por dias entre captures.
- **pace_ratio**: `(entregue_até_hoje / dias_decorridos) / (prometido / dias_totais_da_janela)`.
- **cost_per_play_real**: `sum(deals.amount) / sum(deltas_de_plays)`.

### Skeleton e estados vazios
- Empty state "Nenhum deal ativo" → CTA pra `/playlist-deals`.
- Empty state "Sem snapshots ainda" → texto neutro, sem CTA.

### Performance
- Uma única chamada paralela `Promise.all([snapshots, logs, deals])`.
- Limite 5k linhas (snapshots tem 4.7k hoje, sobra folga).
- Sem realtime nesta fase.

---

## 9. O que NÃO está neste plano

- Não cria triggers, jobs ou sync entre snapshots e campaigns.
- Não toca em ingestão, ops-agent, edge functions, bot.
- Não apaga tabelas/views legadas.
- Não mexe em `/campanhas`, `/playlist-deals`, `/clientes`, `/curadores`.
- Sem mudanças visuais cosméticas — só alinhamento real ao motor vivo.

---

## 10. Critério de "pronto"

- `/analytics` mostra números coerentes com a operação real (snapshots de hoje).
- Zero imports de `campaign_allocations`, `v_playlist_delivery_history`, `v_campaign_velocity` ou RPC `get_campaign_analytics_overview` na nova `Analytics.tsx`.
- KPI "Custo por play" bate com o cálculo manual em SQL nos últimos 30 dias.
- `Performance.tsx` não exibe mais o painel de insights congelados.
- Documento `DEPRECATED_ANALYTICS.md` listando o que foi aposentado.
