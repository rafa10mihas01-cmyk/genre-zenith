ALTER TABLE public.curator_playlists 
  ADD COLUMN IF NOT EXISTS spotify_dead boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS spotify_dead_at timestamptz,
  ADD COLUMN IF NOT EXISTS spotify_dead_reason text;
CREATE INDEX IF NOT EXISTS idx_curator_playlists_spotify_dead ON public.curator_playlists(spotify_dead) WHERE spotify_dead = false;