-- Causa raiz: predicate de "already_present" desalinhado do índice único
-- idx_catalog_placements_unique_alive (... WHERE status <> 'removed').
-- Alinhamos ambas as funções pra evitar INSERT que viola a constraint.

CREATE OR REPLACE FUNCTION public.engine_try_consume_target(_target_id uuid, _now timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t   record;
  v_mp  record;
  v_in_cooldown boolean;
  v_already boolean;
  v_placement_id uuid;
BEGIN
  SELECT * INTO v_t FROM public.catalog_distribution_plan_targets
   WHERE id = _target_id AND status = 'pending' FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT mp.archived_at,
         COALESCE(o.available_slots, mp.catalog_capacity, 0) AS available
    INTO v_mp
    FROM public.managed_playlists mp
    LEFT JOIN public.v_catalog_playlist_occupancy o ON o.managed_playlist_id = mp.id
   WHERE mp.id = v_t.managed_playlist_id;

  IF v_mp.archived_at IS NOT NULL THEN
    UPDATE public.catalog_distribution_plan_targets
       SET status='skipped', skip_reason='playlist_archived', updated_at=_now
     WHERE id = _target_id;
    RETURN false;
  END IF;

  IF COALESCE(v_mp.available,0) <= 0 THEN
    UPDATE public.catalog_distribution_plan_targets
       SET status='skipped', skip_reason='no_capacity', updated_at=_now
     WHERE id = _target_id;
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.playlist_cooldowns pc
     WHERE pc.playlist_id = v_t.managed_playlist_id
       AND pc.action_type IN ('tracks_light','tracks_recycle')
       AND pc.cooldown_until > _now
  ) INTO v_in_cooldown;
  IF v_in_cooldown THEN
    UPDATE public.catalog_distribution_plan_targets
       SET status='skipped', skip_reason='cooldown', updated_at=_now
     WHERE id = _target_id;
    RETURN false;
  END IF;

  -- FIX: alinhar com idx_catalog_placements_unique_alive (status <> 'removed').
  -- Qualquer placement não-removido bloqueia o INSERT — incluindo skipped/failed/etc.
  SELECT EXISTS(
    SELECT 1 FROM public.catalog_placements cp
     WHERE cp.catalog_track_id = v_t.catalog_track_id
       AND cp.managed_playlist_id = v_t.managed_playlist_id
       AND cp.status <> 'removed'
  ) INTO v_already;
  IF v_already THEN
    UPDATE public.catalog_distribution_plan_targets
       SET status='skipped', skip_reason='already_present', updated_at=_now
     WHERE id = _target_id;
    RETURN false;
  END IF;

  -- Cinto + suspensório: ON CONFLICT pra blindar contra corrida entre claims paralelos.
  INSERT INTO public.catalog_placements (
    catalog_track_id, managed_playlist_id, status, scheduled_for, origin
  ) VALUES (
    v_t.catalog_track_id, v_t.managed_playlist_id, 'pending', _now, 'CATALOG'
  )
  ON CONFLICT ON CONSTRAINT idx_catalog_placements_unique_alive DO NOTHING
  RETURNING id INTO v_placement_id;

  IF v_placement_id IS NULL THEN
    UPDATE public.catalog_distribution_plan_targets
       SET status='skipped', skip_reason='already_present', updated_at=_now
     WHERE id = _target_id;
    RETURN false;
  END IF;

  UPDATE public.catalog_distribution_plan_targets
     SET status='scheduled', scheduled_for=_now, distributed_at=_now,
         placement_id=v_placement_id, skip_reason=NULL, updated_at=_now
   WHERE id = _target_id;

  RETURN true;
END $function$;


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
  v_inserted int := 0;
BEGIN
  SELECT id, status, genre_id INTO v_track FROM public.catalog_tracks WHERE id = _track_id;
  IF v_track.id IS NULL OR v_track.status <> 'active' THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.catalog_distribution_plans
   WHERE catalog_track_id = _track_id AND status='active' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  v_days := GREATEST(1, LEAST(COALESCE(_days, 5), 30));

  INSERT INTO public.catalog_distribution_plans (
    catalog_track_id, status, window_days, total_eligible, priority,
    started_at, expected_end_at, next_wave_at, notes
  ) VALUES (
    _track_id, 'active', v_days, 0, 5,
    v_now, v_now + (v_days || ' days')::interval, v_now,
    'scheduler_v3_capacity'
  ) RETURNING id INTO v_plan_id;

  -- FIX: alinhar com idx_catalog_placements_unique_alive — exclui qualquer
  -- playlist que já tenha placement não-removido pra não tentar inserir duplicado depois.
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
          AND cp.status <> 'removed')
  ON CONFLICT (plan_id, managed_playlist_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.catalog_distribution_plans
     SET total_eligible = v_inserted,
         status = CASE WHEN v_inserted = 0 THEN 'empty' ELSE 'active' END,
         next_wave_at = CASE WHEN v_inserted = 0 THEN NULL ELSE v_now END,
         completed_at = CASE WHEN v_inserted = 0 THEN v_now ELSE NULL END,
         updated_at = v_now
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END $function$;