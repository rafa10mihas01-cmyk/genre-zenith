# Fase 2 — Playlist Intelligence + Health Engine

Objetivo: ensinar o sistema a avaliar cada playlist canônica (`playlists`) com 5 scores 0–100 recalculados diariamente, e expor na tela **Operação > Minhas Playlists** — sem quebrar nada existente.

---

## 1. Nova tabela `playlist_scores`

```text
playlist_scores
├── id               uuid PK
├── playlist_id      uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE  UNIQUE
├── health_score     smallint NOT NULL DEFAULT 0   (0-100)
├── delivery_score   smallint NOT NULL DEFAULT 0
├── capacity_score   smallint NOT NULL DEFAULT 0
├── risk_score       smallint NOT NULL DEFAULT 0
├── activity_score   smallint NOT NULL DEFAULT 0
├── calculated_at    timestamptz NOT NULL DEFAULT now()
├── metadata         jsonb NOT NULL DEFAULT '{}'   (insumos do cálculo)
└── created_at       timestamptz NOT NULL DEFAULT now()
```

- `UNIQUE(playlist_id)` → 1 linha por playlist; recálculo faz `UPSERT`.
- RLS `has_team_access()` em SELECT/INSERT/UPDATE/DELETE.
- Índices: `(health_score DESC)`, `(calculated_at)`.

Tabela é **derivada/cacheada**: pode ser truncada e recriada sem perder dados de negócio.

---

## 2. Fontes de dados (sem alterar nada)

| Score | Fonte primária | Janela |
|---|---|---|
| capacity | `curator_deal_snapshots.plays_28d` agregado por `spotify_playlist_id`; fallback `curator_playlists.streams_28d`/`streams_7d` | 28d |
| delivery | `curator_playlists.streams_total` somado por `canonical_playlist_id` em deals fechados / com música ativa | lifetime nas campanhas |
| activity | `curator_playlist_library.last_used_at` + `times_used`; para `own`: `managed_playlists.updated_at`/`last_synced_at` se existir | 90d |
| risk | desvio entre `plays_7d` (×4) vs `plays_28d` no último snapshot por playlist; e drop entre snapshots consecutivos | últimos 2–3 snapshots |
| health | composto ponderado: `0.30·capacity + 0.25·delivery + 0.20·activity + 0.25·(100−risk)` | derivado |

Tudo lido via **`canonical_playlist_id`** (Fase 1). Playlists sem canonical_id ficam com scores 0 e `metadata.reason='no_canonical'`.

---

## 3. Função SQL `recalc_playlist_scores()`

`SECURITY DEFINER`, `search_path = public`. Executa em uma transação:

1. CTE `agg_snapshots`: agrega `curator_deal_snapshots` por `canonical_playlist_id` (via JOIN com `curator_playlists`) → soma `plays_28d`, `plays_7d`, `plays_24h`, `max(captured_at)`.
2. CTE `agg_deals`: soma `streams_total`, `streams_28d`, `streams_7d` por `canonical_playlist_id` em `curator_playlists`.
3. CTE `agg_library`: `times_used`, `last_used_at` por `canonical_playlist_id` em `curator_playlist_library`.
4. CTE `agg_managed`: `last_synced_at`/`updated_at` por `canonical_playlist_id` em `managed_playlists`.
5. CTE `scores`: aplica fórmulas de normalização (escala log para volumes, capping em 100, mínimo 0).
6. `INSERT … ON CONFLICT (playlist_id) DO UPDATE SET …` em `playlist_scores`.

Fórmulas de normalização (resumo):

- `capacity_score = LEAST(100, GREATEST(0, round(100 * ln(1 + plays_28d) / ln(1 + 50000))))`
- `delivery_score = LEAST(100, GREATEST(0, round(100 * ln(1 + streams_total) / ln(1 + 500000))))`
- `activity_score`: 100 se `last_used_at < 7d`; degrau até 0 em 90d
- `risk_score`: `|4*plays_7d − plays_28d| / NULLIF(plays_28d,0)` normalizado (cap 100); +20 se queda >50% entre 2 últimos snapshots
- `health_score`: combinação ponderada acima

Os tetos (50k, 500k, 90d) ficam em uma CTE `params` no topo da função para ajuste futuro sem migration.

`metadata` armazena os insumos brutos: `{plays_28d, plays_7d, streams_total, times_used, last_used_at, last_snapshot_at}` — útil para depurar e para a UI mostrar "por quê".

---

## 4. Cron diário

`pg_cron` (já habilitado no projeto, usado em outros lugares):

```sql
SELECT cron.schedule(
  'recalc-playlist-scores-daily',
  '15 3 * * *',  -- 03:15 UTC diário
  $$ SELECT public.recalc_playlist_scores(); $$
);
```

Sem `pg_net`, sem edge function — roda 100% no DB, custo zero. Idempotente por design (UPSERT).

Também exponho um RPC `trigger_recalc_playlist_scores()` (chamado pelo botão "Recalcular agora" na UI; gated por `has_team_access()` via security definer com check interno).

---

## 5. UI — Operação > Minhas Playlists

Localizar a página atual (provavelmente `src/pages/Playlists.tsx` ou similar) e adicionar **sem remover nada**:

- 4 KPI tiles no topo: média de health, capacidade total estimada (28d), playlists em risco (risk ≥ 60), playlists inativas (activity < 30).
- Coluna nova nas rows existentes (ou cells na grid):
  - `<StatusDot variant={health → success/warning/danger}>` + número
  - 4 mini-barras (`Progress` compacto) para os outros 4 scores, com tooltip mostrando o número exato
- Botão discreto "Recalcular scores" no header (chama o RPC; toast com `calculated_at` mais recente).
- Filtros já existentes continuam intactos; adiciono ordenação por `health_score`.

Apenas frontend de leitura — nenhuma escrita nova além do botão de recálculo manual.

---

## 6. O que **NÃO** será feito

- Sem alterar tabelas existentes.
- Sem mudar bot, edge functions, RPCs antigas.
- Sem deletar a tela antiga ou mudar rotas.
- Sem alertas/notificações automáticos (Fase 3).
- Sem expor scores para curador/cliente (apenas operação).

---

## 7. Entregáveis

1. **Migration** com:
   - Tabela `playlist_scores` + RLS + índices.
   - Função `recalc_playlist_scores()`.
   - Função `trigger_recalc_playlist_scores()` (security definer wrapper).
   - Primeiro recálculo executado dentro da migration (`SELECT recalc_playlist_scores();`).
2. **SQL via insert tool** (não migration — contém URLs/keys de cron) para o `cron.schedule`.
3. **Frontend**: hook `usePlaylistScores`, componente `PlaylistScoreCell`, integração na página de Minhas Playlists, botão "Recalcular".

---

## 8. Verificação

- `SELECT count(*) FROM playlist_scores;` deve ≈ count playlists com canonical ligado.
- `SELECT avg(health_score), max(health_score), min(health_score) FROM playlist_scores;` — distribuição plausível.
- UI renderiza scores nas linhas existentes sem regressão.

Posso prosseguir.