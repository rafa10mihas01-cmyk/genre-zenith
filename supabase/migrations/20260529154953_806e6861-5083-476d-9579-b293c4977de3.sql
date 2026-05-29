-- Gap 6: min_health_score por gênero (default 40)
ALTER TABLE public.genre_models
  ADD COLUMN IF NOT EXISTS min_health_score integer NOT NULL DEFAULT 40;

-- Gap 7: flip default da feature flag auto_deal_from_campaign para true
ALTER TABLE public.system_flags
  ALTER COLUMN auto_deal_from_campaign SET DEFAULT true;

UPDATE public.system_flags
  SET auto_deal_from_campaign = true
  WHERE auto_deal_from_campaign IS DISTINCT FROM true;