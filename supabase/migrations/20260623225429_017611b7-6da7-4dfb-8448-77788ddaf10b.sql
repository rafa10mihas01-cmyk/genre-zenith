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

  -- ON CONFLICT na forma de índice parcial (catalog_track_id, managed_playlist_id) WHERE status <> 'removed'
  INSERT INTO public.catalog_placements (
    catalog_track_id, managed_playlist_id, status, scheduled_for, origin
  ) VALUES (
    v_t.catalog_track_id, v_t.managed_playlist_id, 'pending', _now, 'CATALOG'
  )
  ON CONFLICT (catalog_track_id, managed_playlist_id) WHERE status <> 'removed' DO NOTHING
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