CREATE OR REPLACE FUNCTION public.preview_distribute_catalog_track(p_spotify_track_id text, p_genre_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_track_id uuid;
  v_track_exists boolean := false;
  v_genre_name text;
  v_pool_total int := 0;
  v_cap_total int := 0;
  v_cap_used int := 0;
  v_cap_free int := 0;
  v_eligible jsonb;
  v_already jsonb;
  v_no_capacity jsonb;
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
    SELECT mp.id, mp.name, mp.cover_url, mp.followers, mp.catalog_capacity,
           COALESCE(mp.tracks_count, 0) AS tracks_count,
           COALESCE(o.available_slots, mp.catalog_capacity) AS available_slots,
           (cp.managed_playlist_id IS NOT NULL) AS is_present
    FROM managed_playlists mp
    LEFT JOIN v_catalog_playlist_occupancy o ON o.managed_playlist_id = mp.id
    LEFT JOIN catalog_placements cp
      ON cp.managed_playlist_id = mp.id
     AND cp.catalog_track_id = v_track_id
     AND cp.status <> 'removed'
    WHERE mp.is_catalog = true
      AND mp.archived_at IS NULL
      AND mp.genre_id = p_genre_id
  )
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(catalog_capacity),0)::int,
    COALESCE(SUM(catalog_capacity - available_slots),0)::int,
    COALESCE(SUM(available_slots),0)::int,
    COALESCE(jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'cover_url',cover_url,'followers',followers,
        'available_slots',available_slots,'tracks_count',tracks_count,
        'projected_position',tracks_count + 1
      ) ORDER BY followers DESC NULLS LAST)
      FILTER (WHERE NOT is_present AND available_slots > 0), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'cover_url',cover_url,'followers',followers,
        'tracks_count',tracks_count
      ) ORDER BY followers DESC NULLS LAST)
      FILTER (WHERE is_present), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'cover_url',cover_url,'followers',followers,
        'tracks_count',tracks_count
      ) ORDER BY followers DESC NULLS LAST)
      FILTER (WHERE NOT is_present AND available_slots <= 0), '[]'::jsonb)
  INTO v_pool_total, v_cap_total, v_cap_used, v_cap_free, v_eligible, v_already, v_no_capacity
  FROM pool;

  RETURN jsonb_build_object(
    'ok', true,
    'track_exists', v_track_exists,
    'genre_id', p_genre_id,
    'genre_name', v_genre_name,
    'genre_pool_total', v_pool_total,
    'genre_capacity_total', v_cap_total,
    'genre_capacity_used', v_cap_used,
    'genre_capacity_free', v_cap_free,
    'eligible_count', jsonb_array_length(v_eligible),
    'already_present_count', jsonb_array_length(v_already),
    'no_capacity_count', jsonb_array_length(v_no_capacity),
    'eligible', v_eligible,
    'already_present', v_already,
    'no_capacity', v_no_capacity
  );
END;
$function$;