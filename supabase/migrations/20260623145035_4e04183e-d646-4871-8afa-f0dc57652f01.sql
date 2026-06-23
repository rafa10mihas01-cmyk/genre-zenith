
CREATE OR REPLACE FUNCTION public.engine_backfill_legacy_distribution_plan(
  _track_id uuid,
  _days smallint DEFAULT 5
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan_id uuid;
  v_existing uuid;
  v_track record;
  v_days smallint;
  v_now timestamptz := now();
  v_done_count int := 0;
  v_pending_count int := 0;
BEGIN
  SELECT id, status, genre_id INTO v_track FROM public.catalog_tracks WHERE id = _track_id;
  IF v_track.id IS NULL OR v_track.status <> 'active' THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.catalog_distribution_plans
   WHERE catalog_track_id = _track_id AND status = 'active' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  v_days := GREATEST(1::smallint, LEAST(COALESCE(_days, 5::smallint), 30::smallint));

  INSERT INTO public.catalog_distribution_plans (
    catalog_track_id, status, window_days, total_eligible, priority,
    started_at, expected_end_at, next_wave_at, notes
  ) VALUES (
    _track_id, 'active', v_days, 0, 5,
    v_now, v_now + (v_days || ' days')::interval, v_now,
    'legacy_backfill_v1'
  ) RETURNING id INTO v_plan_id;

  INSERT INTO public.catalog_distribution_plan_targets (
    plan_id, catalog_track_id, managed_playlist_id, status,
    scheduled_for, distributed_at, placement_id
  )
  SELECT
    v_plan_id, _track_id, cp.managed_playlist_id, 'done',
    COALESCE(cp.added_at, v_now), COALESCE(cp.added_at, v_now), cp.id
  FROM public.catalog_placements cp
  WHERE cp.catalog_track_id = _track_id
    AND cp.status IN ('pending','active')
    AND cp.managed_playlist_id IS NOT NULL
  ON CONFLICT (plan_id, managed_playlist_id) DO NOTHING;

  GET DIAGNOSTICS v_done_count = ROW_COUNT;

  INSERT INTO public.catalog_distribution_plan_targets (
    plan_id, catalog_track_id, managed_playlist_id, status, scheduled_for
  )
  SELECT v_plan_id, _track_id, o.managed_playlist_id, 'pending', v_now
    FROM public.v_catalog_playlist_occupancy o
    JOIN public.managed_playlists mp ON mp.id = o.managed_playlist_id
   WHERE o.archived_at IS NULL
     AND o.available_slots > 0
     AND (v_track.genre_id IS NULL OR mp.genre_id IS NULL OR mp.genre_id = v_track.genre_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.playlist_cooldowns pc
        WHERE pc.playlist_id = o.managed_playlist_id
          AND pc.action_type IN ('tracks_light','tracks_recycle')
          AND pc.cooldown_until > v_now)
     AND NOT EXISTS (
       SELECT 1 FROM public.catalog_placements cp
        WHERE cp.catalog_track_id = _track_id
          AND cp.managed_playlist_id = o.managed_playlist_id
          AND cp.status IN ('pending','active'))
  ON CONFLICT (plan_id, managed_playlist_id) DO NOTHING;

  GET DIAGNOSTICS v_pending_count = ROW_COUNT;

  UPDATE public.catalog_distribution_plans
     SET total_eligible = v_done_count + v_pending_count,
         total_distributed = v_done_count,
         status = CASE
           WHEN (v_done_count + v_pending_count) = 0 THEN 'empty'
           WHEN v_pending_count = 0 THEN 'completed'
           ELSE 'active'
         END,
         next_wave_at = CASE WHEN v_pending_count = 0 THEN NULL ELSE v_now END,
         completed_at = CASE WHEN v_pending_count = 0 THEN v_now ELSE NULL END,
         updated_at = v_now
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END $$;

REVOKE ALL ON FUNCTION public.engine_backfill_legacy_distribution_plan(uuid, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_backfill_legacy_distribution_plan(uuid, smallint) TO service_role, authenticated;

DO $$
DECLARE
  r record;
  v_plan uuid;
BEGIN
  FOR r IN
    SELECT ct.id, ct.track_name
      FROM public.catalog_tracks ct
     WHERE ct.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM public.catalog_distribution_plans p
          WHERE p.catalog_track_id = ct.id AND p.status = 'active'
       )
  LOOP
    v_plan := public.engine_backfill_legacy_distribution_plan(r.id, 5::smallint);
    RAISE NOTICE 'Backfill: track=% plan=%', r.track_name, v_plan;
  END LOOP;
END $$;
