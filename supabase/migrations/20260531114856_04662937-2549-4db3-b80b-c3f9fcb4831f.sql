
ALTER TABLE public.song_snapshot_playlists
  ADD COLUMN spotify_url TEXT;

CREATE INDEX idx_snapshot_playlists_url
  ON public.song_snapshot_playlists(spotify_url)
  WHERE spotify_url IS NOT NULL;
