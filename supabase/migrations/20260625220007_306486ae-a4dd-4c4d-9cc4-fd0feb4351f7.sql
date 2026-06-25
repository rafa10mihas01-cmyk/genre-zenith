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
  v_already_present int := 0;
  v_distribution_count int := 0;
BEGIN
  IF p_genre_id IS NULL THEN
    RAISE EXCEPTION 'genre_id obrigatório';
  END IF;

  SELECT nome INTO v_genre_name
  FROM public.genres
  WHERE id = p_genre_id;

  IF v_genre_name IS NULL THEN
    RAISE EXCEPTION 'genre_id inválido';
  END IF;

  SELECT id INTO v_track_id
  FROM public.catalog_tracks
  WHERE spotify_track_id = p_spotify_track_id;

  v_track_exists := v_track_id IS NOT NULL;

  WITH pool AS (
    SELECT
      mp.id,
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
    WHERE mp.genre_id = p_genre_id
      AND COALESCE(mp.operational_status, '') <> 'do_not_operate'
  )
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE already_present)::int,
    COUNT(*) FILTER (WHERE NOT already_present)::int
  INTO v_pool_total, v_already_present, v_distribution_count
  FROM pool;

  RETURN jsonb_build_object(
    'ok', true,
    'track_exists', v_track_exists,
    'genre_id', p_genre_id,
    'genre_name', v_genre_name,
    'pool_total', v_pool_total,
    'already_present_count', v_already_present,
    'distribution_count', v_distribution_count,
    'eligible_total', v_distribution_count
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
      'occupancy_engine_genre_universe_except_do_not_operate'
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
    mp.spotify_playlist_id
  FROM public.managed_playlists mp
  WHERE mp.genre_id = v_track.genre_id
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

  SELECT COUNT(*)::int INTO v_total_targets
  FROM _catalog_distribution_targets;

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
    v_plan_id, _track_id, t.managed_playlist_id, 'scheduled',
    v_now, v_now, c.placement_id, 'occupancy_engine'
  FROM _catalog_distribution_targets t
  JOIN cp_rows c ON c.managed_playlist_id = t.managed_playlist_id
  ON CONFLICT (plan_id, managed_playlist_id) DO UPDATE
    SET status = 'scheduled',
        scheduled_for = EXCLUDED.scheduled_for,
        distributed_at = EXCLUDED.distributed_at,
        placement_id = EXCLUDED.placement_id,
        skip_reason = EXCLUDED.skip_reason,
        updated_at = v_now;

  UPDATE public.catalog_distribution_plans
     SET total_eligible = v_total_targets,
         total_distributed = v_total_targets,
         total_skipped = 0,
         status = CASE WHEN v_total_targets = 0 THEN 'empty' ELSE 'completed' END,
         next_wave_at = NULL,
         completed_at = v_now,
         notes = 'occupancy_engine_genre_universe_except_do_not_operate',
         updated_at = v_now
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_distribute_catalog_track(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_distribute_catalog_track(text, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.engine_create_distribution_plan(uuid, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_create_distribution_plan(uuid, smallint) TO authenticated, service_role;