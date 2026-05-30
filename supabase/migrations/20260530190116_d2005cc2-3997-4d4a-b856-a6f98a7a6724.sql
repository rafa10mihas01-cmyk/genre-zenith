ALTER TABLE public.curator_deal_songs
  ADD COLUMN IF NOT EXISTS spotify_artist_id text,
  ADD COLUMN IF NOT EXISTS spotify_artist_url text;

CREATE INDEX IF NOT EXISTS idx_curator_deal_songs_spotify_artist_id
  ON public.curator_deal_songs(spotify_artist_id)
  WHERE spotify_artist_id IS NOT NULL;