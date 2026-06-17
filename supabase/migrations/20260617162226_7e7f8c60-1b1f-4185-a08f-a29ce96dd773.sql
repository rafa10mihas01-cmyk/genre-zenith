-- Recria a view sem o alias legado is_baseline.
DROP VIEW IF EXISTS public.v_curator_playlists_operational CASCADE;

CREATE VIEW public.v_curator_playlists_operational AS
SELECT
  id,
  deal_id,
  spotify_url,
  playlist_name,
  followers,
  is_initial_roster,
  added_at,
  song_id,
  spotify_playlist_id,
  spotify_owner_id,
  spotify_owner_name,
  image_url,
  added_at_spotify,
  match_status,
  match_reason,
  streams_7d,
  streams_28d,
  streams_total,
  position_in_paste,
  last_paste_at,
  attribution_method,
  attribution_reason,
  canonical_playlist_id,
  is_observational
FROM public.curator_playlists
WHERE is_observational = false;

GRANT SELECT ON public.v_curator_playlists_operational TO authenticated;
GRANT SELECT ON public.v_curator_playlists_operational TO anon;
GRANT ALL  ON public.v_curator_playlists_operational TO service_role;