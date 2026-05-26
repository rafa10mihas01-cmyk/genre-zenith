ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_campaigns_status_started_at ON public.campaigns(status, started_at) WHERE closed_at IS NULL;