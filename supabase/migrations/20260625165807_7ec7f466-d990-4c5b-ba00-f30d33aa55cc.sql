
DROP VIEW IF EXISTS public.v_playlist_track_origin;

CREATE VIEW public.v_playlist_track_origin AS
WITH base AS (
  SELECT
    mpt.playlist_id AS managed_playlist_id,
    mpt.spotify_track_id,
    mpt.position
  FROM public.managed_playlist_tracks mpt
),
camp AS (
  SELECT DISTINCT
    mp.id AS managed_playlist_id,
    mpt.spotify_track_id,
    (array_agg(cpc.campaign_id))[1] AS campaign_id
  FROM public.managed_playlist_tracks mpt
  JOIN public.managed_playlists mp ON mp.id = mpt.playlist_id
  JOIN public.campaign_playlist_collections cpc ON cpc.playlist_id = mp.spotify_playlist_id
  GROUP BY mp.id, mpt.spotify_track_id
),
cat AS (
  SELECT DISTINCT cp.managed_playlist_id, ct.spotify_track_id
  FROM public.catalog_placements cp
  JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
  WHERE cp.status = 'active'
)
SELECT
  b.managed_playlist_id,
  b.spotify_track_id,
  b.position,
  CASE
    WHEN c.spotify_track_id  IS NOT NULL THEN 'Campaign'
    WHEN ca.spotify_track_id IS NOT NULL THEN 'Catalog'
    ELSE 'ThirdParty'
  END AS origin,
  c.campaign_id
FROM base b
LEFT JOIN camp c
  ON c.managed_playlist_id = b.managed_playlist_id
 AND c.spotify_track_id   = b.spotify_track_id
LEFT JOIN cat ca
  ON ca.managed_playlist_id = b.managed_playlist_id
 AND ca.spotify_track_id   = b.spotify_track_id;

GRANT SELECT ON public.v_playlist_track_origin TO authenticated, service_role;
