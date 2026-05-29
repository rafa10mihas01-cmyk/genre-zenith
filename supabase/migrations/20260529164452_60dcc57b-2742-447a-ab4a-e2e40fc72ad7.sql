ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS spotify_artist_id text,
  ADD COLUMN IF NOT EXISTS image_url text;

CREATE INDEX IF NOT EXISTS idx_clients_spotify_artist_id
  ON public.clients (spotify_artist_id)
  WHERE spotify_artist_id IS NOT NULL;