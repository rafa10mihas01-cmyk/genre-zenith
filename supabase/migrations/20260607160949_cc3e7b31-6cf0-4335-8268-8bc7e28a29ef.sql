CREATE OR REPLACE FUNCTION public.get_campaign_radio_collected(_campaign_id uuid)
RETURNS TABLE (
  campaign_id uuid,
  spotify_track_id text,
  start_plays_7d bigint,
  start_captured_at timestamp with time zone,
  current_plays_7d bigint,
  last_captured_at timestamp with time zone,
  radio_delta bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (s.spotify_song_id)
      s.spotify_song_id,
      s.captured_at,
      ssp.plays_7d
    FROM public.song_snapshots s
    JOIN public.song_snapshot_playlists ssp ON ssp.snapshot_id = s.id
    WHERE (ssp.spotify_playlist_id = 'radio' OR (ssp.spotify_playlist_id IS NULL AND lower(ssp.name) = 'radio'))
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
  FROM public.campaigns c
  JOIN latest l ON l.spotify_song_id = c.spotify_track_id
  WHERE c.id = _campaign_id
    AND public.has_team_access();
$$;

REVOKE ALL ON FUNCTION public.get_campaign_radio_collected(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_radio_collected(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_radio_collected(uuid) TO service_role;

ALTER VIEW public.campaign_radio_collected SET (security_invoker = true);

GRANT SELECT ON public.campaign_radio_collected TO authenticated;
GRANT ALL ON public.campaign_radio_collected TO service_role;