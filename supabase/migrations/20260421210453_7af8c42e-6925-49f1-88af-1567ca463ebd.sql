ALTER TABLE public.search_results ADD COLUMN IF NOT EXISTS is_valid boolean NOT NULL DEFAULT true;
ALTER TABLE public.search_results ADD COLUMN IF NOT EXISTS validation_reason text;
CREATE INDEX IF NOT EXISTS idx_search_results_is_valid ON public.search_results (is_valid);