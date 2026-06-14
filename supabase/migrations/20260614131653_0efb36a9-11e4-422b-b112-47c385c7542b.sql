
CREATE TABLE public.catalog_track_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_track_id uuid NOT NULL REFERENCES public.catalog_tracks(id) ON DELETE CASCADE,
  spotify_popularity integer,
  monthly_listeners bigint,
  artist_followers bigint,
  spotify_followers bigint,
  snapshot_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_track_snapshots_unique_day UNIQUE (catalog_track_id, snapshot_date)
);

CREATE INDEX idx_cts_track ON public.catalog_track_snapshots(catalog_track_id);
CREATE INDEX idx_cts_date ON public.catalog_track_snapshots(snapshot_date DESC);
CREATE INDEX idx_cts_track_date ON public.catalog_track_snapshots(catalog_track_id, snapshot_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_track_snapshots TO authenticated;
GRANT ALL ON public.catalog_track_snapshots TO service_role;

ALTER TABLE public.catalog_track_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "catalog_track_snapshots_auth_read"
  ON public.catalog_track_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "catalog_track_snapshots_service_all"
  ON public.catalog_track_snapshots
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- View consolidada: baseline (snapshot mais antigo) vs último snapshot por track,
-- usada pela tela Performance e pelo painel "Top 10 que mais cresceram".
CREATE OR REPLACE VIEW public.v_catalog_track_performance AS
WITH latest AS (
  SELECT DISTINCT ON (catalog_track_id)
    catalog_track_id,
    spotify_popularity,
    monthly_listeners,
    artist_followers,
    spotify_followers,
    snapshot_date
  FROM public.catalog_track_snapshots
  ORDER BY catalog_track_id, snapshot_date DESC, created_at DESC
),
baseline AS (
  SELECT DISTINCT ON (catalog_track_id)
    catalog_track_id,
    spotify_popularity AS baseline_popularity,
    monthly_listeners  AS baseline_monthly,
    artist_followers   AS baseline_artist_followers,
    spotify_followers  AS baseline_spotify_followers,
    snapshot_date      AS baseline_date
  FROM public.catalog_track_snapshots
  ORDER BY catalog_track_id, snapshot_date ASC, created_at ASC
)
SELECT
  t.id                                  AS catalog_track_id,
  t.track_name,
  t.artist_name,
  t.cover_url,
  t.isrc,
  t.spotify_track_id,
  t.added_at,
  b.baseline_popularity,
  b.baseline_monthly,
  b.baseline_artist_followers,
  b.baseline_spotify_followers,
  b.baseline_date,
  l.spotify_popularity                  AS current_popularity,
  l.monthly_listeners                   AS current_monthly,
  l.artist_followers                    AS current_artist_followers,
  l.spotify_followers                   AS current_spotify_followers,
  l.snapshot_date                       AS current_date,
  (l.spotify_popularity - b.baseline_popularity)       AS delta_popularity,
  (l.monthly_listeners  - b.baseline_monthly)          AS delta_monthly,
  (l.artist_followers   - b.baseline_artist_followers) AS delta_artist_followers,
  (l.spotify_followers  - b.baseline_spotify_followers) AS delta_spotify_followers,
  CASE
    WHEN b.baseline_monthly IS NULL OR b.baseline_monthly = 0 THEN NULL
    ELSE ROUND( ((l.monthly_listeners - b.baseline_monthly)::numeric / b.baseline_monthly::numeric) * 100, 2)
  END AS pct_monthly_growth
FROM public.catalog_tracks t
LEFT JOIN baseline b ON b.catalog_track_id = t.id
LEFT JOIN latest   l ON l.catalog_track_id = t.id;

GRANT SELECT ON public.v_catalog_track_performance TO authenticated, service_role;
