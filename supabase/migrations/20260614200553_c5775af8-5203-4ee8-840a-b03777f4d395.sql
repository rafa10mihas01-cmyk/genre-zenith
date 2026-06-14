CREATE OR REPLACE VIEW public.v_catalog_track_distribution_stats AS
SELECT ct.id AS catalog_track_id,
    ct.track_name,
    ct.artist_name,
    ct.isrc,
    ct.genre_id,
    count(cp.id)::integer AS placements_total,
    count(cp.id) FILTER (WHERE cp.status = 'pending')::integer AS placements_pending,
    count(cp.id) FILTER (WHERE cp.status = 'active')::integer AS placements_active,
    count(cp.id) FILTER (
      WHERE cp.status = 'failed'
        AND cp.updated_at >= (now() - interval '14 days')
        AND NOT EXISTS (
          SELECT 1 FROM public.catalog_placements cp2
          WHERE cp2.catalog_track_id = cp.catalog_track_id
            AND cp2.managed_playlist_id = cp.managed_playlist_id
            AND cp2.status = 'active'
        )
    )::integer AS placements_failed,
    count(cp.id) FILTER (WHERE cp.status = 'removed')::integer AS placements_removed,
    max(cp.added_at) AS last_active_at,
    min(cp.created_at) AS first_placement_at
FROM public.catalog_tracks ct
LEFT JOIN public.catalog_placements cp ON cp.catalog_track_id = ct.id
GROUP BY ct.id;