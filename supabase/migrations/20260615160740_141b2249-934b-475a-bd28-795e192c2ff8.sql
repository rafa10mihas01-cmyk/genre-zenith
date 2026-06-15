
CREATE TABLE IF NOT EXISTS public.observer_playlist_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_playlist_id text NOT NULL,
  spotify_track_id text NOT NULL,
  position int NOT NULL,
  name text,
  artist text,
  album_name text,
  album_cover_url text,
  duration_ms int,
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  correlation_id text,
  raw jsonb,
  CONSTRAINT observer_playlist_tracks_unique UNIQUE (spotify_playlist_id, spotify_track_id, captured_date)
);

CREATE INDEX IF NOT EXISTS idx_opt_playlist_date ON public.observer_playlist_tracks (spotify_playlist_id, captured_date DESC);
CREATE INDEX IF NOT EXISTS idx_opt_track ON public.observer_playlist_tracks (spotify_track_id);
CREATE INDEX IF NOT EXISTS idx_opt_captured_at ON public.observer_playlist_tracks (captured_at DESC);

GRANT SELECT ON public.observer_playlist_tracks TO authenticated;
GRANT ALL ON public.observer_playlist_tracks TO service_role;

ALTER TABLE public.observer_playlist_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read observer tracks"
  ON public.observer_playlist_tracks
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages observer tracks"
  ON public.observer_playlist_tracks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
