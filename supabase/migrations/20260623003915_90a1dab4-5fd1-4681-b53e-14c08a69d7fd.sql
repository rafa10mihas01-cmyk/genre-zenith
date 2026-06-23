CREATE OR REPLACE FUNCTION public.preview_distribute_catalog_track(p_spotify_track_id text, p_genre_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_track_id uuid;
  v_track_exists boolean := false;
  v_genre_name text;
  v_max_per_track constant int := 90;
  v_pool_total int := 0;
  v_eligible_total int := 0;
  v_already_present int := 0;
  v_no_capacity int := 0;
BEGIN
  IF p_genre_id IS NULL THEN RAISE EXCEPTION 'genre_id obrigatório'; END IF;
  SELECT nome INTO v_genre_name FROM genres WHERE id = p_genre_id;
  IF v_genre_name IS NULL THEN RAISE EXCEPTION 'genre_id inválido'; END IF;

  SELECT id INTO v_track_id FROM catalog_tracks WHERE spotify_track_id = p_spotify_track_id;
  v_track_exists := v_track_id IS NOT NULL;

  WITH pool AS (
    SELECT
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
  )
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE NOT is_present AND available_slots > 0)::int,
    COUNT(*) FILTER (WHERE is_present)::int,
    COUNT(*) FILTER (WHERE NOT is_present AND available_slots <= 0)::int
  INTO v_pool_total, v_eligible_total, v_already_present, v_no_capacity
  FROM pool;

  RETURN jsonb_build_object(
    'ok', true,
    'track_exists', v_track_exists,
    'genre_id', p_genre_id,
    'genre_name', v_genre_name,
    'max_per_track', v_max_per_track,
    'pool_total', v_pool_total,
    'eligible_total', v_eligible_total,
    'already_present_count', v_already_present,
    'no_capacity_count', v_no_capacity,
    'capped', (v_eligible_total > v_max_per_track)
  );
END;
$function$;