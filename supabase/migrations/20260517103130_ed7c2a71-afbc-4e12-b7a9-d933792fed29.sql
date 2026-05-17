ALTER TABLE public.playlist_diagnoses
  ADD COLUMN IF NOT EXISTS tracks_analysis JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tracks_summary JSONB NOT NULL DEFAULT '{}'::jsonb;