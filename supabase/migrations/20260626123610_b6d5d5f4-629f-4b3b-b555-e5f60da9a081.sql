DROP VIEW IF EXISTS public.v_catalog_track_distribution_stats;

CREATE VIEW public.v_catalog_track_distribution_stats
WITH (security_invoker=on) AS
SELECT
  ct.id AS catalog_track_id,
  ct.track_name,
  ct.artist_name,
  ct.isrc,
  ct.genre_id,
  count(cp.id)::integer AS placements_total,
  (
    count(cp.id) FILTER (WHERE cp.status = 'pending')
    + count(cp.id) FILTER (
        WHERE cp.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM public.managed_playlist_tracks mpt
            WHERE mpt.playlist_id = cp.managed_playlist_id
              AND mpt.spotify_track_id = ct.spotify_track_id
          )
      )
  )::integer AS placements_pending,
  count(cp.id) FILTER (
    WHERE cp.status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.managed_playlist_tracks mpt
        WHERE mpt.playlist_id = cp.managed_playlist_id
          AND mpt.spotify_track_id = ct.spotify_track_id
      )
  )::integer AS placements_active,
  count(cp.id) FILTER (
    WHERE cp.status = 'failed'
      AND cp.last_error_code IS NOT NULL
      AND cp.updated_at >= (now() - interval '14 days')
      AND NOT EXISTS (
        SELECT 1 FROM public.catalog_placements cp_active
        WHERE cp_active.catalog_track_id = ct.id
          AND cp_active.status = 'active'
          AND EXISTS (
            SELECT 1 FROM public.managed_playlist_tracks mpt
            WHERE mpt.playlist_id = cp_active.managed_playlist_id
              AND mpt.spotify_track_id = ct.spotify_track_id
          )
      )
  )::integer AS placements_failed,
  count(cp.id) FILTER (WHERE cp.status = 'removed')::integer AS placements_removed,
  max(cp.added_at) FILTER (
    WHERE cp.status = 'active'
      AND EXISTS (
        SELECT 1 FROM public.managed_playlist_tracks mpt
        WHERE mpt.playlist_id = cp.managed_playlist_id
          AND mpt.spotify_track_id = ct.spotify_track_id
      )
  ) AS last_active_at,
  min(cp.created_at) AS first_placement_at
FROM public.catalog_tracks ct
LEFT JOIN public.catalog_placements cp ON cp.catalog_track_id = ct.id
GROUP BY ct.id;

GRANT SELECT ON public.v_catalog_track_distribution_stats TO authenticated, service_role;