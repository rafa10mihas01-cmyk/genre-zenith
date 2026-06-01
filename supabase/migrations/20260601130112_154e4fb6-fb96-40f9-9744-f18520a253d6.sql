CREATE OR REPLACE VIEW public.campaign_radio_collected AS
WITH radio_snaps AS (
  SELECT s.spotify_song_id, s.captured_at, ssp.plays_7d
  FROM public.song_snapshots s
  JOIN public.song_snapshot_playlists ssp ON ssp.snapshot_id = s.id
  WHERE ssp.spotify_playlist_id = 'radio'
    AND ssp.plays_7d IS NOT NULL
    AND s.spotify_song_id IS NOT NULL
),
latest AS (
  SELECT DISTINCT ON (spotify_song_id)
    spotify_song_id, captured_at, plays_7d
  FROM radio_snaps
  ORDER BY spotify_song_id, captured_at DESC
),
prior AS (
  SELECT DISTINCT ON (rs.spotify_song_id)
    rs.spotify_song_id, rs.plays_7d AS prior_plays, rs.captured_at AS prior_captured_at
  FROM radio_snaps rs
  JOIN latest l ON l.spotify_song_id = rs.spotify_song_id
  WHERE rs.captured_at <= l.captured_at - interval '36 hours'
  ORDER BY rs.spotify_song_id, rs.captured_at DESC
)
SELECT
  c.id AS campaign_id,
  c.spotify_track_id,
  l.plays_7d::bigint AS current_plays_7d,
  COALESCE(p.prior_plays, 0)::bigint AS prior_plays_7d,
  (l.plays_7d - COALESCE(p.prior_plays, 0))::bigint AS delta_48h,
  l.captured_at AS last_captured_at,
  p.prior_captured_at AS prior_captured_at
FROM public.campaigns c
JOIN latest l ON l.spotify_song_id = c.spotify_track_id
LEFT JOIN prior p ON p.spotify_song_id = c.spotify_track_id;

GRANT SELECT ON public.campaign_radio_collected TO authenticated;
GRANT SELECT ON public.campaign_radio_collected TO service_role;