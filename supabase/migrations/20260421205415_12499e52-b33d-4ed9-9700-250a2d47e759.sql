ALTER TABLE public.search_results ADD COLUMN IF NOT EXISTS score numeric;
CREATE INDEX IF NOT EXISTS idx_search_results_score ON public.search_results (score DESC NULLS LAST);