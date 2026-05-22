-- 1) search_results: adições não destrutivas
ALTER TABLE public.search_results
  ADD COLUMN IF NOT EXISTS last_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS previous_followers integer,
  ADD COLUMN IF NOT EXISTS followers_growth integer,
  ADD COLUMN IF NOT EXISTS followers_growth_rate numeric,
  ADD COLUMN IF NOT EXISTS freshness_score numeric,
  ADD COLUMN IF NOT EXISTS refresh_tier text,
  ADD COLUMN IF NOT EXISTS next_refresh_due timestamptz;

CREATE INDEX IF NOT EXISTS idx_search_results_next_refresh
  ON public.search_results(next_refresh_due NULLS FIRST)
  WHERE spotify_playlist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_results_refresh_tier
  ON public.search_results(refresh_tier);

-- 2) playlist_followers_snapshots
CREATE TABLE IF NOT EXISTS public.playlist_followers_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_spotify_id text NOT NULL,
  followers integer,
  total_tracks integer,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pfs_playlist_time
  ON public.playlist_followers_snapshots(playlist_spotify_id, captured_at DESC);

ALTER TABLE public.playlist_followers_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pfs_read_auth" ON public.playlist_followers_snapshots
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "pfs_admin_write" ON public.playlist_followers_snapshots
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3) playlist_track_snapshots
CREATE TABLE IF NOT EXISTS public.playlist_track_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_spotify_id text NOT NULL,
  tracks_hash text NOT NULL,
  track_ids text[] NOT NULL DEFAULT '{}',
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pts_playlist_time
  ON public.playlist_track_snapshots(playlist_spotify_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_pts_hash
  ON public.playlist_track_snapshots(playlist_spotify_id, tracks_hash);

ALTER TABLE public.playlist_track_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pts_read_auth" ON public.playlist_track_snapshots
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "pts_admin_write" ON public.playlist_track_snapshots
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4) genre_trends
CREATE TABLE IF NOT EXISTS public.genre_trends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid NOT NULL REFERENCES public.genres(id) ON DELETE CASCADE,
  track_id text NOT NULL,
  artist text,
  track_name text,
  bucket text NOT NULL CHECK (bucket IN ('historic','recent','leader','viral')),
  score numeric NOT NULL DEFAULT 0,
  velocity numeric,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (genre_id, track_id, bucket)
);
CREATE INDEX IF NOT EXISTS idx_genre_trends_bucket
  ON public.genre_trends(genre_id, bucket, score DESC);

ALTER TABLE public.genre_trends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gt_read_auth" ON public.genre_trends
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "gt_admin_write" ON public.genre_trends
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5) playlist_leadership: freshness column
ALTER TABLE public.playlist_leadership
  ADD COLUMN IF NOT EXISTS freshness_rank numeric;