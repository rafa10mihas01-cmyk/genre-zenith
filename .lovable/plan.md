## Fase 6 — Playlist Valuation

Objetivo: responder "vale comprar essa playlist?" combinando os scores existentes, histórico de campanhas e followers em uma recomendação acionável.

### 1. Banco (uma migration)

**RPC `evaluate_playlist(p_playlist_id uuid)`** — retorna jsonb:
- `valuation_score` (0-100): composto ponderado
  - `0.30·capacity + 0.25·delivery + 0.20·health + 0.15·followers_norm + 0.10·(100-risk)`
  - `followers_norm` = `LEAST(100, log10(followers+1) * 20)` (escala log, 100k seguidores ≈ 100)
- `recommendation`: `buy` (≥70), `maybe` (40-69), `skip` (<40)
- `estimated_monthly_plays`: deriva de `v_playlist_delivery_history.avg_daily_delivery * 30`, com fallback para `capacity_score · followers · 0.0005`
- `risk_level`: `low`/`medium`/`high` baseado em `risk_score`
- `growth_potential`: `high`/`medium`/`low` baseado em diferença entre followers e delivery atual
- `factors`: jsonb com cada componente bruto (para tooltip)
- `similar_playlists`: top 5 com valuation_score próximo (mesmo `genre_id` quando existir, fallback por followers ±30%)

**RPC `evaluate_playlist_by_url(p_url text)`**:
- Extrai `spotify_playlist_id` do link
- Se existir em `managed_playlists` → chama `evaluate_playlist`
- Se existir em `curator_playlist_library` → retorna valuation parcial (sem delivery próprio, marca `data_source: 'external_library'`)
- Caso contrário → retorna `{ found: false, message: 'Playlist não está no banco. Importe primeiro.' }`

Nenhuma tabela nova. Nenhuma alteração em colunas existentes.

### 2. Frontend

**Nova página `/valuation` (`src/pages/Valuation.tsx`)**:
- Input: cole link do Spotify + botão "Avaliar"
- Card de resultado:
  - Badge grande com recomendação (verde/amarelo/cinza)
  - Score 0-100 com barra de progresso
  - 4 mini-tiles: Plays/mês estimados, Risco, Potencial de crescimento, Followers
  - Breakdown dos fatores (capacity, delivery, health, risk) em barras
  - Tabela "Playlists similares" (5 linhas) com link para detalhe
- Empty state limpo antes do primeiro input

**`/minhas-playlists` — alterações mínimas**:
- Nova coluna "Valuation" (chama RPC em batch via single query agregada — `evaluate_playlist_batch` ou loop client-side limitado a playlists visíveis)
- Badge "Vale comprar" só para `ownership = 'external'` com `recommendation = 'buy'`
- Toggle de ordenação: "Por valuation"

Para evitar N+1: criar RPC auxiliar `evaluate_playlists_batch(p_ids uuid[])` que retorna array de valuations.

**Sidebar**: novo item "Valuation" com ícone `Gauge`.

### 3. O que NÃO muda

- `recalc_playlist_scores`, `suggest_campaign_playlists`, `get_campaign_analytics_overview` — intactos
- Schemas, RLS, triggers, edge functions, bot — intactos
- Campanhas, curator_deals, analytics — intactos

### 4. Verificação pós-deploy

- Rodar `evaluate_playlist` em 3 playlists conhecidas (uma própria boa, uma própria fraca, uma externa)
- Conferir página `/valuation` com link real
- Conferir badges em `/minhas-playlists`
- Rodar linter Supabase

Aprova para executar?
