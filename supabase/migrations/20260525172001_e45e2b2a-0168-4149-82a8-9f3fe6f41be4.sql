ALTER TABLE public.campaign_eco_allocations
  ADD COLUMN IF NOT EXISTS genre_source TEXT NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS genre_affinity_score NUMERIC;

ALTER TABLE public.campaign_eco_allocations
  DROP CONSTRAINT IF EXISTS campaign_eco_allocations_genre_source_check;

ALTER TABLE public.campaign_eco_allocations
  ADD CONSTRAINT campaign_eco_allocations_genre_source_check
  CHECK (genre_source IN ('primary','affinity'));

CREATE INDEX IF NOT EXISTS idx_campaign_eco_allocations_campaign_genre_source
  ON public.campaign_eco_allocations(campaign_id, genre_source);