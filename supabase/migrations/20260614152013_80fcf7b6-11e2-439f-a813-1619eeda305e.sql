
ALTER TABLE public.curator_deal_songs
  ADD COLUMN IF NOT EXISTS collect_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collect_error_code text,
  ADD COLUMN IF NOT EXISTS collect_paused_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_cds_collect_paused_until
  ON public.curator_deal_songs (collect_paused_until)
  WHERE collect_paused_until IS NOT NULL;
