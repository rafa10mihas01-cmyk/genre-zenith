DROP VIEW IF EXISTS public.v_catalog_playlist_occupancy;

CREATE VIEW public.v_catalog_playlist_occupancy AS
SELECT
  mp.id AS managed_playlist_id,
  mp.name AS playlist_name,
  mp.cover_url,
  mp.tracks_count,
  mp.archived_at,
  mp.campaign_reserved_slots,
  mp.catalog_capacity,
  COALESCE(p.active_placements, 0) AS active_placements,
  GREATEST((mp.catalog_capacity - COALESCE(p.active_placements, 0)), 0) AS available_slots
FROM managed_playlists mp
LEFT JOIN (
  SELECT catalog_placements.managed_playlist_id,
         (count(*))::integer AS active_placements
  FROM catalog_placements
  WHERE catalog_placements.status = 'active'
  GROUP BY catalog_placements.managed_playlist_id
) p ON p.managed_playlist_id = mp.id
WHERE mp.is_catalog = true;

GRANT SELECT ON public.v_catalog_playlist_occupancy TO authenticated;
GRANT SELECT ON public.v_catalog_playlist_occupancy TO service_role;