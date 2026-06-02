
ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS archived_reason TEXT,
  ADD COLUMN IF NOT EXISTS archived_followers INTEGER,
  ADD COLUMN IF NOT EXISTS reactivation_eligible_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_managed_archived_eligible
  ON public.managed_playlists (reactivation_eligible_at)
  WHERE reactivation_eligible_at IS NOT NULL;

-- Backfill: marcamos os já arquivados como "manual" e capturamos o snapshot
-- de followers atual como archived_followers. Não muda nada operacionalmente.
UPDATE public.managed_playlists
SET archived_reason = 'manual',
    archived_followers = followers
WHERE archived_at IS NOT NULL
  AND archived_reason IS NULL;
