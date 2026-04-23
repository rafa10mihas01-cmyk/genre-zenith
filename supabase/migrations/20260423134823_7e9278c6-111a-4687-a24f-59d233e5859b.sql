ALTER TABLE public.search_results
  ADD COLUMN IF NOT EXISTS owner_id text,
  ADD COLUMN IF NOT EXISTS owner_type text;

CREATE INDEX IF NOT EXISTS idx_search_results_owner_type
  ON public.search_results (genre_id, owner_type)
  WHERE owner_type IS NOT NULL;

COMMENT ON COLUMN public.search_results.owner_id IS 'Spotify user id do dono da playlist (ex: spotify, ou user id)';
COMMENT ON COLUMN public.search_results.owner_type IS 'spotify (oficial Spotify), user (usuário comum), ou null (não enriquecido)';