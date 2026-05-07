ALTER TABLE public.curator_deal_songs ADD COLUMN IF NOT EXISTS queued_at timestamptz;

-- Backfill: songs atualmente queued recebem queued_at = updated_at
UPDATE public.curator_deal_songs
SET queued_at = updated_at
WHERE auto_collect_status = 'queued' AND queued_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_curator_deal_songs_queued_at
  ON public.curator_deal_songs (queued_at)
  WHERE auto_collect_status = 'queued';