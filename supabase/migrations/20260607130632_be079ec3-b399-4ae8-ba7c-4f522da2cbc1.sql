CREATE OR REPLACE VIEW public.campaign_radio_collected AS
WITH latest AS (
  SELECT DISTINCT ON (s.spotify_song_id)
    s.spotify_song_id,
    s.captured_at,
    ssp.plays_7d
  FROM song_snapshots s
  JOIN song_snapshot_playlists ssp ON ssp.snapshot_id = s.id
  WHERE (
      ssp.spotify_playlist_id = 'radio'
      OR (ssp.spotify_playlist_id IS NULL AND LOWER(ssp.name) = 'radio')
    )
    AND ssp.plays_7d IS NOT NULL
    AND s.spotify_song_id IS NOT NULL
  ORDER BY s.spotify_song_id, s.captured_at DESC
)
SELECT
  c.id AS campaign_id,
  c.spotify_track_id,
  c.radio_plays_start AS start_plays_7d,
  c.radio_plays_start_at AS start_captured_at,
  l.plays_7d AS current_plays_7d,
  l.captured_at AS last_captured_at,
  GREATEST(l.plays_7d - COALESCE(c.radio_plays_start, l.plays_7d), 0::bigint) AS radio_delta
FROM campaigns c
JOIN latest l ON l.spotify_song_id = c.spotify_track_id;