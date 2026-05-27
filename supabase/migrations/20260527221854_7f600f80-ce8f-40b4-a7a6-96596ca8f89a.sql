CREATE TABLE public.spotify_playlist_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  spotify_playlist_id TEXT NOT NULL UNIQUE,
  image_url TEXT,
  followers INTEGER,
  owner_name TEXT,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spotify_playlist_cache_sp_id ON public.spotify_playlist_cache(spotify_playlist_id);

GRANT SELECT ON public.spotify_playlist_cache TO authenticated;
GRANT ALL ON public.spotify_playlist_cache TO service_role;

ALTER TABLE public.spotify_playlist_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read cache"
  ON public.spotify_playlist_cache FOR SELECT
  TO authenticated
  USING (true);