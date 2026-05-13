
ALTER TABLE public.playlists
  ADD COLUMN IF NOT EXISTS genre_id uuid REFERENCES public.genres(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS monitored boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_playlists_genre_id ON public.playlists(genre_id);
CREATE INDEX IF NOT EXISTS idx_playlists_monitored ON public.playlists(monitored) WHERE monitored = true;

CREATE TABLE IF NOT EXISTS public.genre_benchmarks (
  genre_id uuid PRIMARY KEY REFERENCES public.genres(id) ON DELETE CASCADE,
  sample_size integer NOT NULL DEFAULT 0,
  followers_p50 bigint,
  followers_p75 bigint,
  followers_p90 bigint,
  tracks_p50 integer,
  tracks_p75 integer,
  tracks_p90 integer,
  avg_growth_pct_30d numeric,
  plays_per_follower_estimate numeric NOT NULL DEFAULT 0.05,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.genre_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_genre_benchmarks" ON public.genre_benchmarks
  FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_genre_benchmarks" ON public.genre_benchmarks
  FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_genre_benchmarks" ON public.genre_benchmarks
  FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_genre_benchmarks" ON public.genre_benchmarks
  FOR DELETE TO authenticated USING (has_team_access());
