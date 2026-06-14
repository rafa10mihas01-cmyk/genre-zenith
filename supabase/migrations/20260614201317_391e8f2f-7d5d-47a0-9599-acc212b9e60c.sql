CREATE OR REPLACE VIEW public.v_catalog_track_distribution_stats AS
SELECT
  ct.id AS catalog_track_id,
  ct.track_name,
  ct.artist_name,
  ct.isrc,
  ct.genre_id,
  COUNT(cp.id)::integer AS placements_total,
  COUNT(cp.id) FILTER (WHERE cp.status = 'pending')::integer AS placements_pending,
  COUNT(cp.id) FILTER (WHERE cp.status = 'active')::integer AS placements_active,
  COUNT(cp.id) FILTER (
    WHERE cp.status = 'failed'
      AND cp.last_error_code IS NOT NULL
      AND cp.updated_at >= (now() - interval '14 days')
      AND NOT EXISTS (
        SELECT 1
        FROM public.catalog_placements cp_active
        WHERE cp_active.catalog_track_id = ct.id
          AND cp_active.status = 'active'
      )
  )::integer AS placements_failed,
  COUNT(cp.id) FILTER (WHERE cp.status = 'removed')::integer AS placements_removed,
  MAX(cp.added_at) FILTER (WHERE cp.status = 'active') AS last_active_at,
  MIN(cp.created_at) AS first_placement_at
FROM public.catalog_tracks ct
LEFT JOIN public.catalog_placements cp ON cp.catalog_track_id = ct.id
GROUP BY ct.id;

GRANT SELECT ON public.v_catalog_track_distribution_stats TO authenticated, service_role;