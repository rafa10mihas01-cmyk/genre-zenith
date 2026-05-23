
ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS lifecycle_phase text NOT NULL DEFAULT 'seed',
  ADD COLUMN IF NOT EXISTS lifecycle_phase_updated_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'managed_playlists_lifecycle_phase_chk'
  ) THEN
    ALTER TABLE public.managed_playlists
      ADD CONSTRAINT managed_playlists_lifecycle_phase_chk
      CHECK (lifecycle_phase IN ('seed','growth','mature','bloated','decline'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_managed_playlists_lifecycle_phase
  ON public.managed_playlists (lifecycle_phase) WHERE archived_at IS NULL;

ALTER TABLE public.playlist_brain
  ADD COLUMN IF NOT EXISTS lifecycle_phase text,
  ADD COLUMN IF NOT EXISTS benchmark_tracks integer,
  ADD COLUMN IF NOT EXISTS ratio_to_benchmark numeric(6,3),
  ADD COLUMN IF NOT EXISTS growth_roadmap jsonb NOT NULL DEFAULT '[]'::jsonb;
