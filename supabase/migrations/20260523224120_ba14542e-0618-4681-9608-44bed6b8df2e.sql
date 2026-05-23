ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS split_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_eco_streams integer,
  ADD COLUMN IF NOT EXISTS eco_max_pct integer NOT NULL DEFAULT 70;