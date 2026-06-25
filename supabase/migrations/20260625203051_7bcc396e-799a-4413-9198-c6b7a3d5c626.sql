
CREATE OR REPLACE VIEW public.v_catalog_origin_summary AS
SELECT
  origin,
  COUNT(*)::int AS positions,
  COUNT(DISTINCT spotify_track_id)::int AS distinct_tracks
FROM public.v_playlist_track_origin
GROUP BY origin;

GRANT SELECT ON public.v_catalog_origin_summary TO authenticated, service_role;
