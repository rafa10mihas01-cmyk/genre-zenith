
ALTER TABLE public.search_results
  ADD COLUMN IF NOT EXISTS winner_score numeric,
  ADD COLUMN IF NOT EXISTS winner_score_version smallint DEFAULT 2,
  ADD COLUMN IF NOT EXISTS winner_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS winner_score_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_search_results_winner_score
  ON public.search_results (genre_id, winner_score DESC NULLS LAST)
  WHERE duplicate_of IS NULL AND is_valid = true;
