ALTER TABLE public.sync_log ADD COLUMN IF NOT EXISTS tier text;
CREATE INDEX IF NOT EXISTS idx_sync_log_tier_created ON public.sync_log (tier, created_at DESC);