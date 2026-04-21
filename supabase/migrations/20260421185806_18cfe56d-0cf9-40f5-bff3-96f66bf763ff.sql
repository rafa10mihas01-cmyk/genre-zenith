-- 1. search_results: tracking de tentativas de enriquecimento
ALTER TABLE public.search_results
  ADD COLUMN IF NOT EXISTS enrich_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS enrich_attempts integer NOT NULL DEFAULT 0;

-- 2. search_results: remove owner_country (sem fonte confiável)
ALTER TABLE public.search_results
  DROP COLUMN IF EXISTS owner_country;

-- 3. genre_filters: override de MAX_SEARCH_CALLS por gênero
ALTER TABLE public.genre_filters
  ADD COLUMN IF NOT EXISTS max_search_calls integer;

-- 4. Índice para query de pendentes de enrich (search_results)
CREATE INDEX IF NOT EXISTS idx_search_results_pending_enrich
  ON public.search_results (genre_id, enrich_failed, seguidores)
  WHERE seguidores IS NULL AND enrich_failed = false;
