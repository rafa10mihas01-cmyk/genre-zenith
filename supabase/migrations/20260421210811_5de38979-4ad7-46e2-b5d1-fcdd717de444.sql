ALTER TABLE public.search_results ADD COLUMN IF NOT EXISTS quality_score numeric;
ALTER TABLE public.search_results ADD COLUMN IF NOT EXISTS quality_flag text;
ALTER TABLE public.search_results ADD COLUMN IF NOT EXISTS quality_flagged_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_search_results_quality_flag ON public.search_results (quality_flag, quality_flagged_at);