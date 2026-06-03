
ALTER TABLE public.spotify_apps
  ADD COLUMN IF NOT EXISTS ready_for_deletion BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retirement_audit JSONB;
