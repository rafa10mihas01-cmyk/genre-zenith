-- Fase 1 (corrigida): adicionar colunas + consolidar duplicatas + criar índice único

-- 1. Adicionar colunas de memória
ALTER TABLE public.search_results
  ADD COLUMN IF NOT EXISTS spotify_playlist_id TEXT,
  ADD COLUMN IF NOT EXISTS times_seen INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS priority_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS owner_country TEXT;

-- 2. Backfill spotify_playlist_id a partir da URL
UPDATE public.search_results
SET spotify_playlist_id = regexp_replace(spotify_url, '^.*playlist/([A-Za-z0-9]+).*$', '\1')
WHERE spotify_playlist_id IS NULL
  AND spotify_url IS NOT NULL
  AND spotify_url ~ 'playlist/[A-Za-z0-9]+';

-- 3. Consolidar duplicatas existentes (mantém a mais antiga como sobrevivente)
WITH ranked AS (
  SELECT id, genre_id, spotify_playlist_id, coletado_em,
         ROW_NUMBER() OVER (
           PARTITION BY genre_id, spotify_playlist_id
           ORDER BY coletado_em ASC, id ASC
         ) AS rn
  FROM public.search_results
  WHERE spotify_playlist_id IS NOT NULL
),
keepers AS (
  SELECT genre_id, spotify_playlist_id, id AS keeper_id, coletado_em AS keeper_first
  FROM ranked WHERE rn = 1
),
dupes AS (
  SELECT r.id AS dup_id, k.keeper_id, k.keeper_first, r.coletado_em AS dup_seen
  FROM ranked r
  JOIN keepers k
    ON k.genre_id = r.genre_id
   AND k.spotify_playlist_id = r.spotify_playlist_id
  WHERE r.rn > 1
),
counts AS (
  SELECT keeper_id,
         COUNT(*)::int AS extra_count,
         MAX(dup_seen) AS max_dup_seen,
         MIN(keeper_first) AS keeper_first
  FROM dupes
  GROUP BY keeper_id
),
-- Atualiza linha sobrevivente
upd AS (
  UPDATE public.search_results r
  SET times_seen = COALESCE(r.times_seen, 1) + c.extra_count,
      last_seen_at = GREATEST(COALESCE(r.last_seen_at, r.coletado_em, now()), c.max_dup_seen),
      first_seen_at = LEAST(COALESCE(r.first_seen_at, r.coletado_em, now()), c.keeper_first)
  FROM counts c
  WHERE r.id = c.keeper_id
  RETURNING 1
),
-- Reaponta tracks filhas pra linha sobrevivente
reparent AS (
  UPDATE public.search_tracks t
  SET result_id = d.keeper_id
  FROM dupes d
  WHERE t.result_id = d.dup_id
  RETURNING 1
)
-- Remove duplicatas
DELETE FROM public.search_results
WHERE id IN (SELECT dup_id FROM dupes);

-- 4. Agora sim, criar índice único parcial
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_results_genre_playlist
  ON public.search_results (genre_id, spotify_playlist_id)
  WHERE spotify_playlist_id IS NOT NULL;

-- 5. Índices auxiliares
CREATE INDEX IF NOT EXISTS idx_search_results_priority
  ON public.search_results (genre_id, priority_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_search_results_last_seen
  ON public.search_results (genre_id, last_seen_at DESC);

-- 6. Tabela genre_filters (Fase 3 schema)
CREATE TABLE IF NOT EXISTS public.genre_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id UUID NOT NULL UNIQUE REFERENCES public.genres(id) ON DELETE CASCADE,
  blacklist TEXT[] NOT NULL DEFAULT ARRAY[
    'workout','gym','treino','academia','sleep','study','focus','lofi',
    'edm','techno','house','trance','rock','metal','jazz','classical',
    'random','mix aleatório'
  ],
  min_followers INTEGER,
  max_playlists INTEGER NOT NULL DEFAULT 150,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.genre_filters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_select_genre_filters" ON public.genre_filters;
DROP POLICY IF EXISTS "team_insert_genre_filters" ON public.genre_filters;
DROP POLICY IF EXISTS "team_update_genre_filters" ON public.genre_filters;
DROP POLICY IF EXISTS "team_delete_genre_filters" ON public.genre_filters;

CREATE POLICY "team_select_genre_filters" ON public.genre_filters
  FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_genre_filters" ON public.genre_filters
  FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_genre_filters" ON public.genre_filters
  FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_genre_filters" ON public.genre_filters
  FOR DELETE TO authenticated USING (has_team_access());

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_genre_filters_updated_at ON public.genre_filters;
CREATE TRIGGER trg_genre_filters_updated_at
  BEFORE UPDATE ON public.genre_filters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();