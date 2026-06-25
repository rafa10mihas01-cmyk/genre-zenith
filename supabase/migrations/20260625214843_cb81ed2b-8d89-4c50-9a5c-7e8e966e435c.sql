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
  v_distribution_count int := 0;
  v_already_present int := 0;
  v_no_capacity int := 0;
  v_blocked_count int := 0;
  v_manual_count int := 0;
  v_api_count int := 0;
BEGIN
  IF p_genre_id IS NULL THEN RAISE EXCEPTION 'genre_id obrigatório'; END IF;
  SELECT nome INTO v_genre_name FROM public.genres WHERE id = p_genre_id;
  IF v_genre_name IS NULL THEN RAISE EXCEPTION 'genre_id inválido'; END IF;

  SELECT id INTO v_track_id FROM public.catalog_tracks WHERE spotify_track_id = p_spotify_track_id;
  v_track_exists := v_track_id IS NOT NULL;

  WITH pool AS (
    SELECT
      mp.id,
      mp.execution_mode,
      COALESCE(mp.operational_status, '') AS operational_status,
      COALESCE(o.available_slots, mp.catalog_capacity, 0) AS available_slots,
      (
        mp.spotify_playlist_id IS NULL
        OR mp.spotify_playlist_id = ''
        OR COALESCE(mp.operational_status, '') = 'do_not_operate'
      ) AS is_blocked,
      (
        EXISTS (
          SELECT 1
          FROM public.catalog_placements cp
          WHERE cp.managed_playlist_id = mp.id
            AND cp.catalog_track_id = v_track_id
            AND cp.status <> 'removed'
        )
        OR EXISTS (
          SELECT 1
          FROM public.managed_playlist_tracks mpt
          WHERE mpt.playlist_id = mp.id
            AND mpt.spotify_track_id = p_spotify_track_id
        )
      ) AS already_present
    FROM public.managed_playlists mp
    LEFT JOIN public.v_catalog_playlist_occupancy o ON o.managed_playlist_id = mp.id
    WHERE mp.is_catalog = true
      AND mp.genre_id = p_genre_id
  )
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE already_present)::int,
    COUNT(*) FILTER (WHERE NOT already_present AND NOT is_blocked)::int,
    COUNT(*) FILTER (WHERE NOT already_present AND is_blocked)::int,
    COUNT(*) FILTER (WHERE NOT already_present AND NOT is_blocked AND available_slots <= 0)::int,
    COUNT(*) FILTER (WHERE NOT already_present AND NOT is_blocked AND execution_mode = 'MANUAL_ONLY'::public.playlist_execution_mode)::int,
    COUNT(*) FILTER (WHERE NOT already_present AND NOT is_blocked AND execution_mode <> 'MANUAL_ONLY'::public.playlist_execution_mode)::int
  INTO v_pool_total, v_already_present, v_distribution_count, v_blocked_count, v_no_capacity, v_manual_count, v_api_count
  FROM pool;

  RETURN jsonb_build_object(
    'ok', true,
    'track_exists', v_track_exists,
    'genre_id', p_genre_id,
    'genre_name', v_genre_name,
    'pool_total', v_pool_total,
    'distribution_count', v_distribution_count,
    'eligible_total', v_distribution_count,
    'already_present_count', v_already_present,
    'no_capacity_count', v_no_capacity,
    'blocked_count', v_blocked_count,
    'ignored_count', v_blocked_count,
    'manual_count', v_manual_count,
    'api_count', v_api_count,
    'capped', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.engine_create_distribution_plan(_track_id uuid, _days smallint DEFAULT NULL::smallint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id uuid;
  v_existing uuid;
  v_track record;
  v_days smallint;
  v_now timestamptz := now();
  v_total_targets int := 0;
  v_manual_targets int := 0;
BEGIN
  SELECT id, status, genre_id, spotify_track_id INTO v_track
  FROM public.catalog_tracks
  WHERE id = _track_id;

  IF v_track.id IS NULL OR v_track.status <> 'active' THEN
    RETURN NULL;
  END IF;

  v_days := GREATEST(1, LEAST(COALESCE(_days, 5), 30));

  SELECT id INTO v_existing
  FROM public.catalog_distribution_plans
  WHERE catalog_track_id = _track_id
    AND status = 'active'
  LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO public.catalog_distribution_plans (
      catalog_track_id, status, window_days, total_eligible, priority,
      started_at, expected_end_at, next_wave_at, notes
    ) VALUES (
      _track_id, 'active', v_days, 0, 5,
      v_now, v_now + (v_days || ' days')::interval, v_now,
      'occupancy_engine_all_genre_universe'
    )
    RETURNING id INTO v_plan_id;
  ELSE
    v_plan_id := v_existing;
  END IF;

  DROP TABLE IF EXISTS _catalog_distribution_targets;
  CREATE TEMP TABLE _catalog_distribution_targets ON COMMIT DROP AS
  SELECT
    mp.id AS managed_playlist_id,
    mp.name AS playlist_name,
    mp.spotify_playlist_id,
    mp.execution_mode
  FROM public.managed_playlists mp
  WHERE mp.is_catalog = true
    AND mp.genre_id = v_track.genre_id
    AND mp.spotify_playlist_id IS NOT NULL
    AND mp.spotify_playlist_id <> ''
    AND COALESCE(mp.operational_status, '') <> 'do_not_operate'
    AND NOT EXISTS (
      SELECT 1
      FROM public.catalog_placements cp
      WHERE cp.catalog_track_id = _track_id
        AND cp.managed_playlist_id = mp.id
        AND cp.status <> 'removed'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.managed_playlist_tracks mpt
      WHERE mpt.playlist_id = mp.id
        AND mpt.spotify_track_id = v_track.spotify_track_id
    );

  SELECT COUNT(*)::int INTO v_total_targets FROM _catalog_distribution_targets;
  SELECT COUNT(*)::int INTO v_manual_targets
  FROM _catalog_distribution_targets
  WHERE execution_mode = 'MANUAL_ONLY'::public.playlist_execution_mode;

  INSERT INTO public.catalog_placements (
    catalog_track_id, managed_playlist_id, status, origin, priority, scheduled_for
  )
  SELECT _track_id, t.managed_playlist_id, 'active', 'CATALOG', 2, v_now
  FROM _catalog_distribution_targets t
  ON CONFLICT (catalog_track_id, managed_playlist_id) WHERE status <> 'removed' DO NOTHING;

  WITH cp_rows AS (
    SELECT cp.id AS placement_id, cp.managed_playlist_id
    FROM public.catalog_placements cp
    JOIN _catalog_distribution_targets t ON t.managed_playlist_id = cp.managed_playlist_id
    WHERE cp.catalog_track_id = _track_id
      AND cp.status <> 'removed'
  )
  INSERT INTO public.catalog_distribution_plan_targets (
    plan_id, catalog_track_id, managed_playlist_id, status, scheduled_for,
    distributed_at, placement_id, skip_reason
  )
  SELECT
    v_plan_id,
    _track_id,
    t.managed_playlist_id,
    'scheduled',
    v_now,
    v_now,
    c.placement_id,
    CASE
      WHEN t.execution_mode = 'MANUAL_ONLY'::public.playlist_execution_mode THEN 'manual_queue'
      ELSE 'occupancy_engine'
    END
  FROM _catalog_distribution_targets t
  JOIN cp_rows c ON c.managed_playlist_id = t.managed_playlist_id
  ON CONFLICT (plan_id, managed_playlist_id) DO UPDATE
    SET status = 'scheduled',
        scheduled_for = EXCLUDED.scheduled_for,
        distributed_at = EXCLUDED.distributed_at,
        placement_id = EXCLUDED.placement_id,
        skip_reason = EXCLUDED.skip_reason,
        updated_at = v_now;

  INSERT INTO public.manual_distribution_queue (
    playlist_id, spotify_playlist_id, playlist_name,
    track_id, spotify_track_id, job_type, motivo, status, observacao
  )
  SELECT
    t.managed_playlist_id,
    t.spotify_playlist_id,
    t.playlist_name,
    _track_id,
    v_track.spotify_track_id,
    'CATALOG',
    'manual_only_catalog_distribution',
    'MANUAL_PENDING',
    'Distribuição de catálogo: playlist marcada como execução manual.'
  FROM _catalog_distribution_targets t
  WHERE t.execution_mode = 'MANUAL_ONLY'::public.playlist_execution_mode
    AND NOT EXISTS (
      SELECT 1
      FROM public.manual_distribution_queue mdq
      WHERE mdq.playlist_id = t.managed_playlist_id
        AND mdq.track_id = _track_id
        AND mdq.status IN ('MANUAL_PENDING', 'AUTO_FAILED_FALLBACK_MANUAL')
    );

  UPDATE public.catalog_distribution_plans
     SET total_eligible = v_total_targets,
         total_distributed = v_total_targets,
         total_skipped = 0,
         status = CASE WHEN v_total_targets = 0 THEN 'empty' ELSE 'completed' END,
         next_wave_at = NULL,
         completed_at = v_now,
         notes = 'occupancy_engine_all_genre_universe',
         updated_at = v_now
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.distribute_catalog_track(
  p_spotify_track_id text,
  p_genre_id uuid,
  p_spotify_uri text DEFAULT NULL::text,
  p_isrc text DEFAULT NULL::text,
  p_track_name text DEFAULT NULL::text,
  p_artist_name text DEFAULT NULL::text,
  p_cover_url text DEFAULT NULL::text,
  p_baseline_popularity integer DEFAULT NULL::integer,
  p_baseline_monthly_listeners bigint DEFAULT NULL::bigint,
  p_baseline_streams bigint DEFAULT NULL::bigint,
  p_baseline_raw jsonb DEFAULT NULL::jsonb,
  p_added_by uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_track_row public.catalog_tracks%ROWTYPE;
  v_track_id uuid;
  v_is_new boolean := false;
  v_prev_genre_id uuid;
  v_plan_id uuid;
  v_total_targets int := 0;
BEGIN
  IF p_spotify_track_id IS NULL OR length(trim(p_spotify_track_id)) = 0 THEN
    RAISE EXCEPTION 'spotify_track_id obrigatório';
  END IF;
  IF p_genre_id IS NULL THEN RAISE EXCEPTION 'genre_id obrigatório'; END IF;
  IF p_track_name IS NULL OR p_artist_name IS NULL THEN
    RAISE EXCEPTION 'track_name e artist_name obrigatórios';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.genres WHERE id = p_genre_id) THEN
    RAISE EXCEPTION 'genre_id inválido';
  END IF;

  SELECT * INTO v_track_row
  FROM public.catalog_tracks
  WHERE spotify_track_id = p_spotify_track_id;

  IF NOT FOUND THEN
    INSERT INTO public.catalog_tracks(
      spotify_track_id, spotify_uri, isrc, track_name, artist_name,
      cover_url, added_by, status, genre_id
    ) VALUES (
      p_spotify_track_id, p_spotify_uri, p_isrc, p_track_name, p_artist_name,
      p_cover_url, p_added_by, 'active', p_genre_id
    )
    RETURNING * INTO v_track_row;
    v_is_new := true;
  ELSE
    v_prev_genre_id := v_track_row.genre_id;
    UPDATE public.catalog_tracks SET
      spotify_uri = COALESCE(spotify_uri, p_spotify_uri),
      isrc        = COALESCE(isrc, p_isrc),
      cover_url   = COALESCE(cover_url, p_cover_url),
      genre_id    = p_genre_id,
      updated_at  = now()
    WHERE id = v_track_row.id
    RETURNING * INTO v_track_row;
  END IF;

  v_track_id := v_track_row.id;
  v_plan_id := public.engine_create_distribution_plan(v_track_id, NULL);

  SELECT COALESCE(total_eligible, 0)
  INTO v_total_targets
  FROM public.catalog_distribution_plans
  WHERE id = v_plan_id;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'occupancy_engine_all_genre_universe',
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
    'distribution_plan_id', v_plan_id,
    'total_targets', v_total_targets,
    'total_eligible_playlists', v_total_targets,
    'placements_created', v_total_targets,
    'skipped_already_present', 0,
    'skipped_no_capacity', 0,
    'first_wave_distributed', v_total_targets,
    'first_wave_remaining', 0,
    'capped', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_distribute_catalog_track(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_distribute_catalog_track(text, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.engine_create_distribution_plan(uuid, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_create_distribution_plan(uuid, smallint) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.distribute_catalog_track(text, uuid, text, text, text, text, text, integer, bigint, bigint, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.distribute_catalog_track(text, uuid, text, text, text, text, text, integer, bigint, bigint, jsonb, uuid) TO authenticated, service_role;