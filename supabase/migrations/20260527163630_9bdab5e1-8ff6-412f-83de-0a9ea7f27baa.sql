ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by TEXT;

CREATE INDEX IF NOT EXISTS idx_managed_playlists_lock ON public.managed_playlists (id, locked_at);