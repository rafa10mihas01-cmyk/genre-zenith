# Fase 10 — Observabilidade Evolutiva

Transformar o Genre Brain em **radar cultural vivo**: histórico temporal, drift visual, heatmap de mercado, evolução semântica e de liderança. Sem alertas — só visualização e baseline.

## Escopo

Tudo entra em `/sistema` → aba **Aprendizado** (substitui o `GenreBrainPanel` atual por uma versão expandida com sub-abas). Sem nova rota, sem mexer no sidebar.

```
Aprendizado
 ├─ Visão Geral        (KPIs + sparklines 7d/30d/90d)
 ├─ Timeline Cultural  (eventos por dia: termos, artistas, playlists, drift)
 ├─ Drift Visual       (antes → agora por playlist)
 ├─ Heatmap Mercado    (subgêneros: crescendo / esfriando / saturado)
 ├─ Semântica          (termos nascendo/morrendo, SEO/emoji dominante)
 └─ Liderança          (evolução do leadership_score por playlist)
```

## 1. Schema (migration)

**Tabelas de snapshots temporais** (todas com RLS `select` autenticado, `insert` service role):

- `genre_brain_history` — snapshot diário do `genre_brain` (subgenre, knowledge_score, leadership_avg, drift_count_7d, cluster_strength, freshness_avg, lexical_size, captured_at).
- `genre_trend_events` — eventos discretos da timeline (subgenre, event_type ∈ `term_emerging|term_dying|artist_rising|playlist_growing|cluster_heating|editorial_shift|drift_detected`, payload jsonb, severity, occurred_at).
- `playlist_drift_snapshots` — composição genérica por playlist em pontos no tempo (playlist_id, genre_mix jsonb `{trap:0.82,...}`, captured_at). Usado pra ANTES→AGORA.
- `genre_lexicon_history` — snapshot semanal do léxico (subgenre, term, weight, status ∈ `emerging|stable|declining|dead`, captured_at).
- `playlist_leadership_history` — snapshot diário do leadership_score por playlist (playlist_id, leadership_score, freshness_score, followers, rank, captured_at).
- Índices: `(subgenre, captured_at desc)`, `(playlist_id, captured_at desc)`, `(occurred_at desc)`.

## 2. Edge functions de captura (snapshot)

Funções que persistem o estado atual no histórico (rodam em cron):

- `snapshot-genre-brain` (diário 04:30) → grava `genre_brain_history` a partir de `genre_brain`.
- `snapshot-playlist-leadership` (diário 04:45) → grava `playlist_leadership_history` a partir de `playlist_leadership`.
- `snapshot-playlist-mix` (diário 05:15) → calcula mix de gêneros dos top tracks de cada playlist líder → `playlist_drift_snapshots`.
- `snapshot-genre-lexicon` (semanal dom 03:30) → diff vs snapshot anterior → marca termos `emerging/declining/dead` em `genre_lexicon_history`.
- `detect-trend-events` (diário 06:30) → varre últimos 7d das tabelas de history e gera eventos em `genre_trend_events` (regras: variação ±20% knowledge_score → editorial_shift; novo termo top10 → term_emerging; playlist +30% followers → playlist_growing; etc).

Reutilizam `temporalWeight()` do `_shared/recency.ts`.

## 3. Edge functions de leitura (agregação para UI)

Endpoints que a UI chama (rápidos, GET com query param `?window=7d|30d|90d`):

- `get-brain-overview` → KPIs atuais + série temporal de 7 métricas (knowledge, leadership_avg, drift_activity, cluster_strength, trend_velocity, lexical_growth, freshness) + variação % + direção.
- `get-cultural-timeline` → eventos ordenados, agrupados por dia, filtros por subgenre/type.
- `get-drift-comparison?playlist_id=` → mix atual vs mix de N dias atrás + tracks que entraram/saíram.
- `get-market-heatmap` → array de subgêneros com score de temperatura (`growth`, `activity`, `drift`, `saturation`) → renderizado como grid de células coloridas.
- `get-semantic-evolution?subgenre=` → termos nascendo/morrendo/dominantes + emojis + amostras de títulos.
- `get-leadership-evolution?subgenre=` → top N playlists com série temporal de leadership_score + delta.

## 4. UI (frontend)

**Refatorar** `src/components/sistema/GenreBrainPanel.tsx` em:

```
src/components/sistema/brain/
 ├─ BrainOverviewTab.tsx       (KPI cards + sparklines via recharts)
 ├─ CulturalTimelineTab.tsx    (feed vertical de eventos, ícone por type)
 ├─ DriftVisualTab.tsx         (seletor de playlist → 2 stacked bars ANTES/AGORA + diff de tracks)
 ├─ MarketHeatmapTab.tsx       (grid bento-style, cor = temperatura, tamanho = atividade)
 ├─ SemanticEvolutionTab.tsx   (3 colunas: nascendo / dominante / morrendo + cloud de emojis)
 ├─ LeadershipEvolutionTab.tsx (line chart multi-série + tabela de mudanças)
 └─ shared/
     ├─ MetricCard.tsx         (valor + delta % + direção + sparkline)
     ├─ WindowSelector.tsx     (7d/30d/90d toggle)
     └─ TrendBadge.tsx         (subindo/caindo/estável)
```

Lib: `recharts` (já instalado). Sem novas deps.

### Linguagem visual

Seguir design system existente (bg #050505, card #171717, primary #1DB954 só em ação). Cores temáticas como **acento pequeno**:
- Crescendo → verde-marca (acento)
- Caindo → vermelho-suave
- Estável → muted
- Emergente → âmbar
- Drift → roxo (curadores)

Layout sente-se como radar/observatório: cards grandes, números grandes, gráficos limpos, hover revela detalhes. NÃO parecer painel admin técnico.

## 5. Crons (pg_cron)

5 novos jobs na migration:

| Job | Hora | Função |
|---|---|---|
| `snapshot-brain-daily` | 04:30 | snapshot-genre-brain |
| `snapshot-leadership-history-daily` | 04:45 | snapshot-playlist-leadership |
| `snapshot-playlist-mix-daily` | 05:15 | snapshot-playlist-mix |
| `snapshot-lexicon-weekly` | dom 03:30 | snapshot-genre-lexicon |
| `detect-trend-events-daily` | 06:30 | detect-trend-events |

## 6. Backfill inicial

Migration roda uma vez:
- Copia estado atual de `genre_brain`, `playlist_leadership`, `genre_brain_lexicon` pros `_history` (1 ponto).
- A partir daí os crons constroem a série dia a dia.

Aviso na UI: "Histórico em construção — métricas temporais ficam ricas após 7 dias de captura."

## 7. Out of scope

- Notificações/alertas (Fase 11).
- Mudanças em pipeline `apply-managed-cover`, upload, resize.
- Sidebar, rotas novas.
- Mudanças em `genre_brain` / `playlist_leadership` (só leitura).

## Entrega em 3 PRs lógicos

1. **Schema + backfill + snapshot functions + crons** (validável via SQL).
2. **Funções de leitura agregada** (validáveis via curl).
3. **UI: refator do panel em sub-abas + componentes shared** (validável visualmente em `/sistema?tab=aprendizado`).

Posso começar pelo PR 1 (migration + snapshots)?
