ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS token_revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

ALTER TABLE public.campaign_access_logs
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS user_agent TEXT;