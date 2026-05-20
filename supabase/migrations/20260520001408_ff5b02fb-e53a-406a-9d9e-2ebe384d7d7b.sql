ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS owner_spotify_user_id text;

CREATE INDEX IF NOT EXISTS idx_managed_playlists_owner_spotify_user_id
  ON public.managed_playlists(owner_spotify_user_id)
  WHERE owner_spotify_user_id IS NOT NULL;