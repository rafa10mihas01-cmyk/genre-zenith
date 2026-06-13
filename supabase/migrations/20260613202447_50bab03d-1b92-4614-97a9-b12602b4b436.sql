
CREATE OR REPLACE FUNCTION public.preview_distribute_catalog_track(p_spotify_track_id text, p_genre_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_track_id uuid;
  v_track_exists boolean := false;
  v_genre_name text;
  v_result jsonb;
BEGIN
  IF p_genre_id IS NULL THEN
    RAISE EXCEPTION 'genre_id obrigatório';
  END IF;
  SELECT nome INTO v_genre_name FROM genres WHERE id = p_genre_id;
  IF v_genre_name IS NULL THEN
    RAISE EXCEPTION 'genre_id inválido';
  END IF;

  SELECT id INTO v_track_id FROM catalog_tracks WHERE spotify_track_id = p_spotify_track_id;
  v_track_exists := v_track_id IS NOT NULL;

  WITH pool AS (
    SELECT
      mp.id, mp.name, mp.cover_url, mp.followers, mp.catalog_capacity,
      mp.campaign_reserved_slots,
      (mp.archived_at IS NULL) AS is_hybrid,
      COALESCE((SELECT COUNT(*)::int FROM managed_playlist_tracks mpt WHERE mpt.playlist_id = mp.id), 0) AS real_tracks,
      COALESCE(o.available_slots, mp.catalog_capacity) AS available_slots,
      (cp.managed_playlist_id IS NOT NULL) AS is_present
    FROM managed_playlists mp
    LEFT JOIN v_catalog_playlist_occupancy o ON o.managed_playlist_id = mp.id
    LEFT JOIN catalog_placements cp
      ON cp.managed_playlist_id = mp.id
     AND cp.catalog_track_id = v_track_id
     AND cp.status <> 'removed'
    WHERE mp.is_catalog = true
      AND mp.genre_id = p_genre_id
  ),
  computed AS (
    SELECT
      p.*,
      CASE
        WHEN p.is_hybrid THEN GREATEST(p.real_tracks + 1, p.campaign_reserved_slots + 1)
        ELSE p.real_tracks + 1
      END AS projected_position
    FROM pool p
  )
  SELECT jsonb_build_object(
    'ok', true,
    'track_exists', v_track_exists,
    'genre_id', p_genre_id,
    'genre_name', v_genre_name,
    'pool_total', COUNT(*)::int,
    'pool_hybrid', COUNT(*) FILTER (WHERE is_hybrid)::int,
    'pool_catalog_pure', COUNT(*) FILTER (WHERE NOT is_hybrid)::int,
    'capacity_total', COALESCE(SUM(catalog_capacity),0)::int,
    'capacity_used',  COALESCE(SUM(catalog_capacity - available_slots),0)::int,
    'capacity_free',  COALESCE(SUM(available_slots),0)::int,
    'eligible_hybrid', COALESCE(jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'cover_url',cover_url,'followers',followers,
        'available_slots',available_slots,'real_tracks',real_tracks,
        'campaign_reserved_slots',campaign_reserved_slots,
        'projected_position',projected_position,'kind','hybrid'
      ) ORDER BY followers DESC NULLS LAST)
      FILTER (WHERE is_hybrid AND NOT is_present AND available_slots > 0), '[]'::jsonb),
    'eligible_catalog_pure', COALESCE(jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'cover_url',cover_url,'followers',followers,
        'available_slots',available_slots,'real_tracks',real_tracks,
        'campaign_reserved_slots',campaign_reserved_slots,
        'projected_position',projected_position,'kind','catalog_pure'
      ) ORDER BY followers DESC NULLS LAST)
      FILTER (WHERE NOT is_hybrid AND NOT is_present AND available_slots > 0), '[]'::jsonb),
    'already_present', COALESCE(jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'cover_url',cover_url,'followers',followers,
        'real_tracks',real_tracks,'kind', CASE WHEN is_hybrid THEN 'hybrid' ELSE 'catalog_pure' END
      ) ORDER BY followers DESC NULLS LAST)
      FILTER (WHERE is_present), '[]'::jsonb),
    'no_capacity', COALESCE(jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'cover_url',cover_url,'followers',followers,
        'real_tracks',real_tracks,'kind', CASE WHEN is_hybrid THEN 'hybrid' ELSE 'catalog_pure' END
      ) ORDER BY followers DESC NULLS LAST)
      FILTER (WHERE NOT is_present AND available_slots <= 0), '[]'::jsonb)
  ) INTO v_result
  FROM computed;

  RETURN v_result;
END;
$function$;
