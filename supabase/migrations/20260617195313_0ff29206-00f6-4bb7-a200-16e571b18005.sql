ALTER TABLE public.campaign_access_otps
  ADD COLUMN IF NOT EXISTS failed_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz;

ALTER TABLE public.curator_access_otps
  ADD COLUMN IF NOT EXISTS failed_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_campaign_access_otps_active
  ON public.campaign_access_otps (campaign_id, email, created_at DESC)
  WHERE used_at IS NULL AND blocked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_curator_access_otps_active
  ON public.curator_access_otps (deal_id, email, created_at DESC)
  WHERE used_at IS NULL AND blocked_at IS NULL;