
-- ============================================================
-- Passo 3: Views de leitura para o Catálogo (SECURITY INVOKER)
-- ============================================================

DROP VIEW IF EXISTS public.v_catalog_track_telemetry CASCADE;
CREATE VIEW public.v_catalog_track_telemetry
WITH (security_invoker = true)
AS
WITH snaps AS (
  SELECT
    s.catalog_track_id,
    s.id AS snapshot_id,
    s.captured_at,
    s.total_plays_28d,
    ROW_NUMBER() OVER (PARTITION BY s.catalog_track_id ORDER BY s.captured_at ASC)  AS rn_asc,
    ROW_NUMBER() OVER (PARTITION BY s.catalog_track_id ORDER BY s.captured_at DESC) AS rn_desc
  FROM public.song_snapshots s
  WHERE s.catalog_track_id IS NOT NULL
),
baseline AS (
  SELECT catalog_track_id, captured_at AS baseline_at, total_plays_28d AS baseline_plays_28d
  FROM snaps WHERE rn_asc = 1
),
latest AS (
  SELECT catalog_track_id, snapshot_id AS last_snapshot_id, captured_at AS last_captured_at, total_plays_28d AS last_plays_28d
  FROM snaps WHERE rn_desc = 1
),
latest_playlists AS (
  SELECT
    l.catalog_track_id,
    COUNT(DISTINCT ssp.spotify_playlist_id) FILTER (WHERE ssp.spotify_playlist_id IS NOT NULL) AS playlists_present_count,
    COALESCE(SUM(ssp.plays_7d), 0) AS total_plays_7d_from_playlists
  FROM latest l
  LEFT JOIN public.song_snapshot_playlists ssp ON ssp.snapshot_id = l.last_snapshot_id
  GROUP BY l.catalog_track_id
)
SELECT
  ct.id                                  AS catalog_track_id,
  ct.spotify_track_id,
  ct.track_name,
  ct.artist_name,
  ct.status,
  b.baseline_at,
  b.baseline_plays_28d,
  l.last_captured_at,
  l.last_plays_28d,
  (l.last_plays_28d - b.baseline_plays_28d)                          AS growth_abs,
  CASE
    WHEN b.baseline_plays_28d IS NULL OR b.baseline_plays_28d = 0 THEN NULL
    ELSE ROUND(((l.last_plays_28d - b.baseline_plays_28d)::numeric / b.baseline_plays_28d::numeric) * 100, 2)
  END                                                                 AS growth_pct,
  COALESCE(lp.playlists_present_count, 0)                            AS playlists_present_count,
  COALESCE(lp.total_plays_7d_from_playlists, 0)                      AS total_plays_7d_from_playlists,
  (SELECT COUNT(*) FROM snaps s2 WHERE s2.catalog_track_id = ct.id)  AS snapshots_count
FROM public.catalog_tracks ct
LEFT JOIN baseline b ON b.catalog_track_id = ct.id
LEFT JOIN latest   l ON l.catalog_track_id = ct.id
LEFT JOIN latest_playlists lp ON lp.catalog_track_id = ct.id;

GRANT SELECT ON public.v_catalog_track_telemetry TO authenticated, service_role;

COMMENT ON VIEW public.v_catalog_track_telemetry IS
  'Telemetria do Catálogo derivada de song_snapshots (VPS). Não usar Spotify para alimentar.';

-- ------------------------------------------------------------
-- Atribuição por playlist
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.v_catalog_track_playlist_attribution CASCADE;
CREATE VIEW public.v_catalog_track_playlist_attribution
WITH (security_invoker = true)
AS
WITH per_track_playlist AS (
  SELECT
    s.catalog_track_id,
    ssp.spotify_playlist_id,
    MAX(ssp.name)            AS name,
    MAX(ssp.owner)           AS owner,
    MAX(ssp.spotify_url)     AS spotify_url,
    MIN(s.captured_at)       AS first_seen_at,
    MAX(s.captured_at)       AS last_seen_at,
    COUNT(*)                 AS observations
  FROM public.song_snapshots s
  JOIN public.song_snapshot_playlists ssp ON ssp.snapshot_id = s.id
  WHERE s.catalog_track_id IS NOT NULL
    AND ssp.spotify_playlist_id IS NOT NULL
  GROUP BY s.catalog_track_id, ssp.spotify_playlist_id
),
latest_snap AS (
  SELECT DISTINCT ON (s.catalog_track_id) s.catalog_track_id, s.id AS snapshot_id, s.captured_at
  FROM public.song_snapshots s
  WHERE s.catalog_track_id IS NOT NULL
  ORDER BY s.catalog_track_id, s.captured_at DESC
),
latest_metrics AS (
  SELECT
    ls.catalog_track_id,
    ssp.spotify_playlist_id,
    ssp.position   AS current_position,
    ssp.plays_7d   AS current_plays_7d
  FROM latest_snap ls
  JOIN public.song_snapshot_playlists ssp ON ssp.snapshot_id = ls.snapshot_id
)
SELECT
  ptp.catalog_track_id,
  ptp.spotify_playlist_id,
  ptp.name,
  ptp.owner,
  ptp.spotify_url,
  ptp.first_seen_at,
  ptp.last_seen_at,
  ptp.observations,
  lm.current_position,
  lm.current_plays_7d,
  CASE WHEN lm.spotify_playlist_id IS NULL THEN 'left' ELSE 'active' END AS status
FROM per_track_playlist ptp
LEFT JOIN latest_metrics lm
  ON lm.catalog_track_id = ptp.catalog_track_id
 AND lm.spotify_playlist_id = ptp.spotify_playlist_id;

GRANT SELECT ON public.v_catalog_track_playlist_attribution TO authenticated, service_role;

COMMENT ON VIEW public.v_catalog_track_playlist_attribution IS
  'Atribuição de performance por playlist para o Catálogo. Fonte: song_snapshot_playlists (VPS).';

-- ============================================================
-- Passo 4: Deprecar catalog_track_snapshots
-- ============================================================
COMMENT ON TABLE public.catalog_track_snapshots IS
  'DEPRECATED (2026-06-14): Não usar. Telemetria do catálogo agora vem da VPS via song_snapshots. Ler v_catalog_track_telemetry. Tabela será removida em rodada futura.';
