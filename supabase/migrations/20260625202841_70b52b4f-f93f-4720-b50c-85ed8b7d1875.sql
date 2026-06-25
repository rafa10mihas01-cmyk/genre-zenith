
CREATE OR REPLACE VIEW public.v_playlist_track_origin AS
WITH base AS (
  SELECT mpt.playlist_id AS managed_playlist_id,
         mpt.spotify_track_id,
         mpt."position"
  FROM managed_playlist_tracks mpt
),
camp AS (
  SELECT DISTINCT mp.id AS managed_playlist_id,
         c.spotify_track_id,
         (array_agg(c.id))[1] AS campaign_id
  FROM campaigns c
  JOIN campaign_playlist_collections cpc ON cpc.campaign_id = c.id
  JOIN managed_playlists mp ON mp.spotify_playlist_id = cpc.playlist_id
  WHERE c.status = 'active'
    AND c.spotify_track_id IS NOT NULL
  GROUP BY mp.id, c.spotify_track_id
),
cat AS (
  SELECT DISTINCT cp.managed_playlist_id,
         ct.spotify_track_id
  FROM catalog_placements cp
  JOIN catalog_tracks ct ON ct.id = cp.catalog_track_id
  WHERE cp.status = 'active'
)
SELECT b.managed_playlist_id,
       b.spotify_track_id,
       b."position",
       CASE
         WHEN c.spotify_track_id IS NOT NULL THEN 'Campaign'
         WHEN ca.spotify_track_id IS NOT NULL THEN 'Catalog'
         ELSE 'ThirdParty'
       END AS origin,
       c.campaign_id
FROM base b
LEFT JOIN camp c
  ON c.managed_playlist_id = b.managed_playlist_id
 AND c.spotify_track_id = b.spotify_track_id
LEFT JOIN cat ca
  ON ca.managed_playlist_id = b.managed_playlist_id
 AND ca.spotify_track_id = b.spotify_track_id;
