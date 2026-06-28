CREATE OR REPLACE FUNCTION public.fn_decide_placement_action(p_placement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cp record;
  v_mp record;
  v_ct record;
  v_owner_app_id uuid;
  v_owner_has_token boolean := false;
  v_breaker_open boolean := false;
  v_current_count integer := 0;
  v_planned_ceiling integer := 150;
  v_victim_track text;
BEGIN
  SELECT cp.id, cp.status, cp.catalog_track_id, cp.managed_playlist_id
    INTO v_cp
  FROM public.catalog_placements cp
  WHERE cp.id = p_placement_id;

  IF v_cp.id IS NULL THEN
    RETURN jsonb_build_object('action','SKIP','reason','placement_not_found');
  END IF;

  -- Inclui 'processing' pois o claim faz lock atômico para esse status antes de decidir.
  IF v_cp.status NOT IN ('pending','processing','retry','skipped','waiting_circuit_breaker') THEN
    RETURN jsonb_build_object('action','SKIP','reason','status_not_executable:'||v_cp.status);
  END IF;

  SELECT ct.id, ct.spotify_track_id
    INTO v_ct
  FROM public.catalog_tracks ct
  WHERE ct.id = v_cp.catalog_track_id;

  IF v_ct.id IS NULL OR v_ct.spotify_track_id IS NULL OR v_ct.spotify_track_id = '' THEN
    RETURN jsonb_build_object('action','SKIP','reason','no_track_id');
  END IF;

  SELECT mp.id, mp.spotify_playlist_id, mp.archived_at, mp.execution_mode,
         mp.operational_status, mp.genre_id, mp.owner_spotify_user_id
    INTO v_mp
  FROM public.managed_playlists mp
  WHERE mp.id = v_cp.managed_playlist_id;

  IF v_mp.id IS NULL THEN
    RETURN jsonb_build_object('action','SKIP','reason','playlist_not_found');
  END IF;
  IF v_mp.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('action','SKIP','reason','archived');
  END IF;
  IF v_mp.spotify_playlist_id IS NULL OR v_mp.spotify_playlist_id = '' THEN
    RETURN jsonb_build_object('action','SKIP','reason','no_spotify_id');
  END IF;
  IF v_mp.execution_mode = 'MANUAL_ONLY'::playlist_execution_mode THEN
    RETURN jsonb_build_object('action','SKIP','reason','manual_only');
  END IF;
  IF v_mp.execution_mode = 'DISABLED'::playlist_execution_mode THEN
    RETURN jsonb_build_object('action','SKIP','reason','disabled');
  END IF;
  IF COALESCE(v_mp.operational_status,'') = 'do_not_operate' THEN
    RETURN jsonb_build_object('action','SKIP','reason','do_not_operate');
  END IF;

  IF v_mp.owner_spotify_user_id IS NOT NULL THEN
    SELECT sut.app_id INTO v_owner_app_id
    FROM public.spotify_user_tokens sut
    WHERE sut.spotify_user_id = v_mp.owner_spotify_user_id
    ORDER BY sut.is_default DESC NULLS LAST, sut.updated_at DESC NULLS LAST
    LIMIT 1;

    IF v_owner_app_id IS NOT NULL THEN
      v_owner_has_token := true;
      PERFORM 1
      FROM public.spotify_circuit_breaker scb
      WHERE scb.app_id = v_owner_app_id::text
        AND scb.context = 'operation'
        AND scb.status = 'open'
        AND (scb.blocked_until IS NULL OR scb.blocked_until > now())
      LIMIT 1;
      IF FOUND THEN v_breaker_open := true; END IF;
    END IF;

    IF NOT v_owner_has_token THEN
      RETURN jsonb_build_object('action','SKIP','reason','no_oauth_token');
    END IF;
    IF v_breaker_open THEN
      RETURN jsonb_build_object('action','SKIP','reason','circuit_open');
    END IF;
  END IF;

  PERFORM 1
  FROM public.managed_playlist_tracks mpt
  WHERE mpt.playlist_id = v_mp.id
    AND mpt.spotify_track_id = v_ct.spotify_track_id
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('action','SKIP','reason','already_present');
  END IF;

  SELECT COUNT(*) INTO v_current_count
  FROM public.managed_playlist_tracks mpt
  WHERE mpt.playlist_id = v_mp.id;

  SELECT COALESCE(fp.operational_ceiling, 150) INTO v_planned_ceiling
  FROM public.fn_resolve_playlist_policy(v_mp.id) fp;

  IF v_current_count < v_planned_ceiling THEN
    RETURN jsonb_build_object('action','INSERT');
  END IF;

  SELECT mpt.spotify_track_id
    INTO v_victim_track
  FROM public.managed_playlist_tracks mpt
  LEFT JOIN public.v_playlist_track_origin o
    ON o.managed_playlist_id = mpt.playlist_id
   AND o.spotify_track_id   = mpt.spotify_track_id
  WHERE mpt.playlist_id = v_mp.id
    AND COALESCE(o.origin, 'ThirdParty') = 'ThirdParty'
  ORDER BY mpt.position DESC NULLS LAST
  LIMIT 1;

  IF v_victim_track IS NULL THEN
    RETURN jsonb_build_object('action','SKIP','reason','no_capacity_no_victim');
  END IF;

  RETURN jsonb_build_object(
    'action', 'REMOVE_INSERT',
    'remove_track_id', v_victim_track
  );
END;
$function$;