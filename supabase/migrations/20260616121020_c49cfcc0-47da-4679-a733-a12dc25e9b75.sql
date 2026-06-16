-- 1) distribute_catalog_track: cap 80 -> 90
CREATE OR REPLACE FUNCTION public.distribute_catalog_track(
  p_spotify_track_id text, p_genre_id uuid,
  p_spotify_uri text DEFAULT NULL, p_isrc text DEFAULT NULL,
  p_track_name text DEFAULT NULL, p_artist_name text DEFAULT NULL,
  p_cover_url text DEFAULT NULL,
  p_baseline_popularity integer DEFAULT NULL,
  p_baseline_monthly_listeners bigint DEFAULT NULL,
  p_baseline_streams bigint DEFAULT NULL,
  p_baseline_raw jsonb DEFAULT NULL,
  p_added_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_track_id uuid;
  v_is_new boolean := false;
  v_batch_id uuid;
  v_total_eligible_playlists int := 0;
  v_skipped_already_present int := 0;
  v_skipped_no_capacity int := 0;
  v_placements_created int := 0;
  v_track_row catalog_tracks%ROWTYPE;
  v_prev_genre_id uuid;
  v_max_per_track constant int := 90;
BEGIN
  IF p_spotify_track_id IS NULL OR length(trim(p_spotify_track_id))=0 THEN
    RAISE EXCEPTION 'spotify_track_id obrigatório';
  END IF;
  IF p_genre_id IS NULL THEN RAISE EXCEPTION 'genre_id obrigatório'; END IF;
  IF p_track_name IS NULL OR p_artist_name IS NULL THEN
    RAISE EXCEPTION 'track_name e artist_name obrigatórios';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM genres WHERE id = p_genre_id) THEN
    RAISE EXCEPTION 'genre_id inválido';
  END IF;

  SELECT * INTO v_track_row FROM catalog_tracks WHERE spotify_track_id = p_spotify_track_id;
  IF NOT FOUND THEN
    INSERT INTO catalog_tracks(spotify_track_id, spotify_uri, isrc, track_name, artist_name, cover_url, added_by, status, genre_id)
    VALUES (p_spotify_track_id, p_spotify_uri, p_isrc, p_track_name, p_artist_name, p_cover_url, p_added_by, 'active', p_genre_id)
    RETURNING * INTO v_track_row;
    v_is_new := true;
    INSERT INTO catalog_track_baselines(catalog_track_id, streams, popularity, monthly_listeners, raw_payload)
    VALUES (v_track_row.id, p_baseline_streams, p_baseline_popularity, p_baseline_monthly_listeners, p_baseline_raw);
  ELSE
    v_prev_genre_id := v_track_row.genre_id;
    UPDATE catalog_tracks SET
      spotify_uri = COALESCE(spotify_uri, p_spotify_uri),
      isrc        = COALESCE(isrc, p_isrc),
      cover_url   = COALESCE(cover_url, p_cover_url),
      genre_id    = p_genre_id,
      updated_at  = now()
    WHERE id = v_track_row.id;
    v_track_row.genre_id := p_genre_id;
  END IF;

  v_track_id := v_track_row.id;

  WITH pool AS (
    SELECT mp.id AS managed_playlist_id,
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
  )
  SELECT
    COUNT(*) FILTER (WHERE NOT is_present AND available_slots > 0),
    COUNT(*) FILTER (WHERE is_present),
    COUNT(*) FILTER (WHERE NOT is_present AND available_slots <= 0)
  INTO v_total_eligible_playlists, v_skipped_already_present, v_skipped_no_capacity
  FROM pool;

  INSERT INTO catalog_distribution_batches(
    catalog_track_id, triggered_by,
    total_eligible_playlists, skipped_already_present,
    skipped_no_capacity, placements_created
  ) VALUES (
    v_track_id, p_added_by,
    v_total_eligible_playlists, v_skipped_already_present,
    v_skipped_no_capacity, 0
  ) RETURNING id INTO v_batch_id;

  WITH pool AS (
    SELECT mp.id AS managed_playlist_id,
           mp.campaign_reserved_slots,
           (mp.archived_at IS NULL) AS is_hybrid,
           COALESCE((SELECT COUNT(*)::int FROM managed_playlist_tracks mpt WHERE mpt.playlist_id = mp.id), 0) AS real_tracks,
           COALESCE(o.available_slots, mp.catalog_capacity) AS available_slots,
           (cp.managed_playlist_id IS NOT NULL) AS is_present,
           COALESCE((
             SELECT COUNT(*)::int FROM catalog_placements cp2
             WHERE cp2.managed_playlist_id = mp.id
               AND cp2.status IN ('pending','retry','active')
           ), 0) AS catalog_load
    FROM managed_playlists mp
    LEFT JOIN v_catalog_playlist_occupancy o ON o.managed_playlist_id = mp.id
    LEFT JOIN catalog_placements cp
      ON cp.managed_playlist_id = mp.id
     AND cp.catalog_track_id = v_track_id
     AND cp.status <> 'removed'
    WHERE mp.is_catalog = true
      AND mp.genre_id = p_genre_id
  ),
  selected AS (
    SELECT *
    FROM pool
    WHERE NOT is_present AND available_slots > 0
    ORDER BY catalog_load ASC, random()
    LIMIT v_max_per_track
  ),
  inserted AS (
    INSERT INTO catalog_placements(catalog_track_id, managed_playlist_id, status, distribution_batch_id, position)
    SELECT v_track_id, s.managed_playlist_id, 'pending', v_batch_id,
           CASE
             WHEN s.is_hybrid THEN s.campaign_reserved_slots + 1
             WHEN s.real_tracks < 4 THEN s.real_tracks + 1
             ELSE
               CASE (s.catalog_load % 4)
                 WHEN 0 THEN 1 + floor(random() * GREATEST(1, floor(s.real_tracks::numeric / 2)))::int
                 WHEN 1 THEN 1 + floor(random() * GREATEST(1, floor(s.real_tracks::numeric / 2)))::int
                 WHEN 2 THEN floor(s.real_tracks::numeric / 2)::int + 1
                             + floor(random() * GREATEST(1, floor(s.real_tracks::numeric * 3 / 4)::int - floor(s.real_tracks::numeric / 2)::int))::int
                 ELSE floor(s.real_tracks::numeric * 3 / 4)::int + 1
                      + floor(random() * GREATEST(1, s.real_tracks - floor(s.real_tracks::numeric * 3 / 4)::int + 1))::int
               END
           END
    FROM selected s
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_placements_created FROM inserted;

  UPDATE catalog_distribution_batches SET placements_created = v_placements_created WHERE id = v_batch_id;

  RETURN jsonb_build_object(
    'ok', true,
    'track', jsonb_build_object(
      'id', v_track_row.id,
      'spotify_track_id', v_track_row.spotify_track_id,
      'spotify_uri', v_track_row.spotify_uri,
      'isrc', v_track_row.isrc,
      'track_name', v_track_row.track_name,
      'artist_name', v_track_row.artist_name,
      'cover_url', v_track_row.cover_url,
      'genre_id', v_track_row.genre_id,
      'is_new', v_is_new,
      'previous_genre_id', v_prev_genre_id,
      'genre_changed', (NOT v_is_new AND v_prev_genre_id IS DISTINCT FROM p_genre_id)
    ),
    'distribution_batch_id', v_batch_id,
    'total_eligible_playlists', v_total_eligible_playlists,
    'skipped_already_present', v_skipped_already_present,
    'skipped_no_capacity', v_skipped_no_capacity,
    'placements_created', v_placements_created,
    'max_per_track', v_max_per_track,
    'capped', (v_total_eligible_playlists > v_max_per_track)
  );
END;
$function$;

-- 2) preview_distribute_catalog_track: agora corta em 90 com a MESMA regra
CREATE OR REPLACE FUNCTION public.preview_distribute_catalog_track(
  p_spotify_track_id text, p_genre_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_track_id uuid;
  v_track_exists boolean := false;
  v_genre_name text;
  v_result jsonb;
  v_max_per_track constant int := 90;
  v_pool_eligible_total int := 0;
BEGIN
  IF p_genre_id IS NULL THEN RAISE EXCEPTION 'genre_id obrigatório'; END IF;
  SELECT nome INTO v_genre_name FROM genres WHERE id = p_genre_id;
  IF v_genre_name IS NULL THEN RAISE EXCEPTION 'genre_id inválido'; END IF;

  SELECT id INTO v_track_id FROM catalog_tracks WHERE spotify_track_id = p_spotify_track_id;
  v_track_exists := v_track_id IS NOT NULL;

  WITH pool AS (
    SELECT
      mp.id, mp.name, mp.cover_url, mp.followers, mp.catalog_capacity,
      mp.campaign_reserved_slots,
      (mp.archived_at IS NULL) AS is_hybrid,
      COALESCE((SELECT COUNT(*)::int FROM managed_playlist_tracks mpt WHERE mpt.playlist_id = mp.id), 0) AS real_tracks,
      COALESCE(o.available_slots, mp.catalog_capacity) AS available_slots,
      (cp.managed_playlist_id IS NOT NULL) AS is_present,
      COALESCE((
        SELECT COUNT(*)::int FROM catalog_placements cp2
        WHERE cp2.managed_playlist_id = mp.id
          AND cp2.status IN ('pending','retry','active')
      ), 0) AS catalog_load
    FROM managed_playlists mp
    LEFT JOIN v_catalog_playlist_occupancy o ON o.managed_playlist_id = mp.id
    LEFT JOIN catalog_placements cp
      ON cp.managed_playlist_id = mp.id
     AND cp.catalog_track_id = v_track_id
     AND cp.status <> 'removed'
    WHERE mp.is_catalog = true
      AND mp.genre_id = p_genre_id
  ),
  eligible AS (
    SELECT * FROM pool WHERE NOT is_present AND available_slots > 0
  ),
  selected AS (
    SELECT p.*,
      CASE WHEN p.is_hybrid THEN p.campaign_reserved_slots + 1
           ELSE p.real_tracks + 1 END AS projected_position
    FROM eligible p
    ORDER BY p.catalog_load ASC, random()
    LIMIT v_max_per_track
  ),
  agg AS (
    SELECT
      (SELECT COUNT(*) FROM pool)::int AS pool_total,
      (SELECT COUNT(*) FROM pool WHERE is_hybrid)::int AS pool_hybrid,
      (SELECT COUNT(*) FROM pool WHERE NOT is_hybrid)::int AS pool_catalog_pure,
      (SELECT COALESCE(SUM(catalog_capacity),0) FROM pool)::int AS capacity_total,
      (SELECT COALESCE(SUM(catalog_capacity - available_slots),0) FROM pool)::int AS capacity_used,
      (SELECT COALESCE(SUM(available_slots),0) FROM pool)::int AS capacity_free,
      (SELECT COUNT(*) FROM eligible)::int AS eligible_total
  )
  SELECT jsonb_build_object(
    'ok', true,
    'track_exists', v_track_exists,
    'genre_id', p_genre_id,
    'genre_name', v_genre_name,
    'max_per_track', v_max_per_track,
    'pool_total', a.pool_total,
    'pool_hybrid', a.pool_hybrid,
    'pool_catalog_pure', a.pool_catalog_pure,
    'capacity_total', a.capacity_total,
    'capacity_used', a.capacity_used,
    'capacity_free', a.capacity_free,
    'eligible_total', a.eligible_total,
    'capped', (a.eligible_total > v_max_per_track),
    'selected_count', (SELECT COUNT(*) FROM selected)::int,
    'eligible_hybrid', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'cover_url',cover_url,'followers',followers,
        'available_slots',available_slots,'real_tracks',real_tracks,
        'campaign_reserved_slots',campaign_reserved_slots,
        'catalog_load',catalog_load,
        'projected_position',projected_position,'kind','hybrid'
      ) ORDER BY followers DESC NULLS LAST)
      FROM selected WHERE is_hybrid
    ), '[]'::jsonb),
    'eligible_catalog_pure', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'cover_url',cover_url,'followers',followers,
        'available_slots',available_slots,'real_tracks',real_tracks,
        'campaign_reserved_slots',campaign_reserved_slots,
        'catalog_load',catalog_load,
        'projected_position',projected_position,'kind','catalog_pure'
      ) ORDER BY followers DESC NULLS LAST)
      FROM selected WHERE NOT is_hybrid
    ), '[]'::jsonb),
    'already_present', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'cover_url',cover_url,'followers',followers,
        'real_tracks',real_tracks,'kind', CASE WHEN is_hybrid THEN 'hybrid' ELSE 'catalog_pure' END
      ) ORDER BY followers DESC NULLS LAST)
      FROM pool WHERE is_present
    ), '[]'::jsonb),
    'no_capacity', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'cover_url',cover_url,'followers',followers,
        'real_tracks',real_tracks,'kind', CASE WHEN is_hybrid THEN 'hybrid' ELSE 'catalog_pure' END
      ) ORDER BY followers DESC NULLS LAST)
      FROM pool WHERE NOT is_present AND available_slots <= 0
    ), '[]'::jsonb)
  ) INTO v_result
  FROM agg a;

  RETURN v_result;
END;
$function$;