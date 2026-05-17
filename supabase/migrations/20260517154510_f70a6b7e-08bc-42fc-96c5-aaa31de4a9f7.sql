
-- ============ ONDA 1: schema upgrades ============

ALTER TABLE public.search_results
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_score_version smallint,
  ADD COLUMN IF NOT EXISTS canonical_playlist_id uuid REFERENCES public.search_results(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES public.search_results(id) ON DELETE SET NULL;

-- nome_normalizado: lowercase, sem acentos, sem pontuação, trim
CREATE OR REPLACE FUNCTION public.normalize_playlist_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(regexp_replace(
    lower(translate(coalesce(p_name,''),
      'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN'
    )),
    '[^a-z0-9 ]+', ' ', 'g'
  ));
$$;

ALTER TABLE public.search_results
  ADD COLUMN IF NOT EXISTS nome_normalizado text
    GENERATED ALWAYS AS (public.normalize_playlist_name(nome_playlist)) STORED;

CREATE INDEX IF NOT EXISTS idx_search_results_enriched_at
  ON public.search_results (enriched_at);
CREATE INDEX IF NOT EXISTS idx_search_results_nome_norm
  ON public.search_results (nome_normalizado);
CREATE INDEX IF NOT EXISTS idx_search_results_duplicate_of
  ON public.search_results (duplicate_of) WHERE duplicate_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_results_canonical
  ON public.search_results (canonical_playlist_id) WHERE canonical_playlist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_results_owner_nome_norm
  ON public.search_results (genre_id, owner_id, nome_normalizado)
  WHERE owner_id IS NOT NULL;

-- Backfill: tudo que já foi enriquecido pelo Spotify ganha enriched_at = followers_verified_at
UPDATE public.search_results
SET enriched_at = followers_verified_at
WHERE enriched_at IS NULL
  AND followers_source = 'spotify_api'
  AND followers_verified_at IS NOT NULL;

-- Backfill básico de quality_score nas enriquecidas que não têm score (v1)
UPDATE public.search_results
SET
  quality_score = LEAST(100, GREATEST(0,
      (CASE
        WHEN coalesce(seguidores,0) >= 100000 THEN 50
        WHEN coalesce(seguidores,0) >= 10000  THEN 40
        WHEN coalesce(seguidores,0) >= 1000   THEN 30
        WHEN coalesce(seguidores,0) >= 100    THEN 15
        WHEN coalesce(seguidores,0) > 0       THEN 5
        ELSE 0 END)
    + (CASE
        WHEN coalesce(total_musicas,0) >= 100 THEN 30
        WHEN coalesce(total_musicas,0) >= 50  THEN 20
        WHEN coalesce(total_musicas,0) >= 30  THEN 12
        WHEN coalesce(total_musicas,0) >= 10  THEN 5
        ELSE 0 END)
    + (CASE WHEN imagem_url IS NOT NULL AND length(imagem_url) > 10 THEN 10 ELSE 0 END)
    + (CASE WHEN descricao IS NOT NULL AND length(trim(descricao)) >= 20 THEN 10 ELSE 0 END)
  )),
  quality_score_version = 1
WHERE quality_score IS NULL
  AND enriched_at IS NOT NULL;

-- Garante version=1 para quem já tinha score legado
UPDATE public.search_results
SET quality_score_version = 1
WHERE quality_score IS NOT NULL AND quality_score_version IS NULL;

-- ============ Relatório de Onda 1 ============
CREATE TABLE IF NOT EXISTS public.discovery_wave1_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid REFERENCES public.genres(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  discovered int NOT NULL DEFAULT 0,
  removed int NOT NULL DEFAULT 0,
  invalid int NOT NULL DEFAULT 0,
  duplicates int NOT NULL DEFAULT 0,
  approved int NOT NULL DEFAULT 0,
  benchmark_size int NOT NULL DEFAULT 0,
  top_problems jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wave1_reports_run ON public.discovery_wave1_reports (run_id);
CREATE INDEX IF NOT EXISTS idx_wave1_reports_genre ON public.discovery_wave1_reports (genre_id);

ALTER TABLE public.discovery_wave1_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_select_wave1_reports" ON public.discovery_wave1_reports;
CREATE POLICY "team_select_wave1_reports"
  ON public.discovery_wave1_reports
  FOR SELECT TO authenticated
  USING (public.has_team_access());
