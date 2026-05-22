# Fase 9 — NexEngine Vivo

Objetivo: o catálogo passa a respirar no mesmo ritmo do cérebro. Foco em **freshness**, **ingestão contínua**, **recorrência ponderada por tempo** e **velocidade de tendência**.

Nenhuma mudança em `apply-managed-cover`, upload manual, resize ou compressão.

---

## 1. Schema (migration)

### `search_results` (adições, não destrutivo)
- `last_refreshed_at timestamptz`
- `previous_followers integer`
- `followers_growth integer` (delta vs último snapshot)
- `followers_growth_rate numeric` (delta / dias)
- `freshness_score numeric` (0–1, calculado)
- `refresh_tier text` ('leader' | 'medium' | 'small')  — define cadência
- `next_refresh_due timestamptz` — coluna alvo do worker

### `playlist_followers_snapshots` (nova — série temporal leve)
- `playlist_spotify_id text`
- `followers integer`
- `total_tracks integer`
- `captured_at timestamptz`
- índice composto (`playlist_spotify_id`, `captured_at desc`)

### `playlist_track_snapshots` (nova — pra detectar troca de tracks)
- `playlist_spotify_id text`
- `track_ids text[]` (hash leve dos top 50)
- `tracks_hash text`
- `captured_at timestamptz`

### `genre_trends` (nova — pool dinâmico por subgênero)
- `genre_id uuid`
- `track_id text`, `artist text`, `track_name text`
- `bucket text` ('historic' | 'recent' | 'leader' | 'viral')
- `score numeric`, `velocity numeric`
- `last_seen_at timestamptz`
- chave (`genre_id`, `track_id`, `bucket`)

Tudo com RLS: leitura authenticated, escrita admin / service role.

---

## 2. Edge Functions (novas)

### `refresh-search-results`
- Lê `search_results` ordenado por `next_refresh_due asc`.
- Define tier:
  - `leader` (followers > 100k OU playlist em `playlist_leadership` ≥ 0.55) → diário
  - `medium` (followers 10k–100k) → semanal
  - `small` → quinzenal
- Para cada playlist: chama Spotify `GET /playlists/{id}` (campos: followers, name, images, tracks.total, snapshot_id) usando helper compartilhado.
- Atualiza `search_results`: `seguidores`, `nome`, `cover_url`, `total_tracks`, `previous_followers`, `followers_growth`, `followers_growth_rate`, `last_refreshed_at`, `next_refresh_due`.
- Insere linha em `playlist_followers_snapshots`.
- Recalcula `freshness_score`.
- Batch size configurável (default 50/run, limit por tier).

### `snapshot-playlist-tracks`
- Só para playlists tier `leader` + amostragem de `medium`.
- Pega top 50 tracks, gera hash determinístico, grava em `playlist_track_snapshots` somente quando hash mudou.
- Saída usada por `compute-trend-velocity`.

### `compute-trend-velocity`
- Lê `playlist_track_snapshots` últimos 14d e histórico 60d.
- Para cada (track_id, genre_id) calcula:
  - `presence_14d`, `presence_60d`
  - `trend_velocity = presence_14d / max(1, presence_60d/4)`
  - `emergence_score`: penaliza tracks já dominantes históricos
- Upsert em `genre_trends` bucket `recent` / `viral` (velocity > 2.5).

### `build-genre-reference-pool`
- Por subgênero ativo, monta pool de 40:
  - 10 histórico (top recorrência ponderada por tempo)
  - 15 recente (trend_velocity alto)
  - 10 leader (tracks que aparecem em playlists com leadership ≥ 0.55)
  - 5 viral (emergence_score alto)
- Grava em `genre_trends` bucket correspondente; substitui pool anterior do mesmo bucket por subgênero (transacional).

---

## 3. Recorrência temporal (`_shared/recency.ts`)

Já existe `recency.ts` da Fase 2. Estender com:
```ts
export function temporalWeight(days: number): number {
  if (days <= 30) return 1.0;
  if (days <= 90) return 0.7;
  if (days <= 180) return 0.4;
  if (days <= 365) return 0.15;
  return 0.05;
}
```
E aplicar em `genre-confidence-calc`, `compute-leadership`, `detect-genre-drift` substituindo o peso linear por `temporalWeight(daysSince(last_seen))`.

Saturação de leader_followers é resolvida via:
- `freshness_score` entra como multiplicador no leadership formula:
  `leadership_score = 0.35*followers + 0.20*growth + 0.20*activity + 0.10*benchmark + 0.15*freshness`
- Normalização por log: `log10(followers+1)/log10(MAX+1)` em vez de divisão crua, eliminando saturação no topo.

---

## 4. Freshness Score (fórmula)

`freshness_score (0–1)` =
- 0.30 × `recency_factor` (1 se `last_refreshed_at` ≤ 7d, decai linear até 90d)
- 0.25 × `followers_growth_norm` (clamp do growth_rate)
- 0.20 × `track_change_recency` (snapshot mudou últimos 30d)
- 0.15 × `editorial_activity` (mudanças nos últimos 90d)
- 0.10 × `update_velocity` (frequência de snapshot_id distintos)

---

## 5. Crons (insert via cron.schedule)

| Job | Cron | Função |
|---|---|---|
| `refresh-leaders-daily` | `0 5 * * *` | `refresh-search-results` body `{ tier: "leader" }` |
| `refresh-medium-weekly` | `0 5 * * 2` | `{ tier: "medium" }` |
| `refresh-small-biweekly` | `0 5 1,15 * *` | `{ tier: "small" }` |
| `snapshot-tracks-daily` | `30 5 * * *` | `snapshot-playlist-tracks` |
| `compute-trend-velocity-daily` | `0 6 * * *` | `compute-trend-velocity` |
| `build-reference-pool-daily` | `30 6 * * *` | `build-genre-reference-pool` |

Encadeamento: refresh → snapshot → velocity → pool → (à noite) leadership/brain rodam com dados frescos.

---

## 6. UI (mínimo, não invasivo)

- `GenreBrainPanel`: adicionar coluna `freshness_avg` no detail drawer + badge "vivo/parado" no card (verde se freshness ≥ 0.6, cinza se < 0.3).
- Sem nova página.

---

## 7. Fora de escopo (explícito)

- `apply-managed-cover` — intocado
- upload manual, resize, compressão — intocados
- design system, sidebar, rotas — sem mudança

---

## Entrega em 3 PRs lógicos dentro desta loop

1. **Schema + helpers** (migration + `recency.ts` estendido)
2. **Edge functions** (`refresh-search-results`, `snapshot-playlist-tracks`, `compute-trend-velocity`, `build-genre-reference-pool`) + ajuste em `compute-leadership` (log + freshness)
3. **Crons + UI badge freshness**

Tudo deployable e validado por chamadas curl antes de fechar.
