ALTER TABLE public.catalog_placements
  ADD COLUMN IF NOT EXISTS copy_index smallint NOT NULL DEFAULT 1;

ALTER TABLE public.catalog_placements
  DROP CONSTRAINT IF EXISTS catalog_placements_copy_index_check;
ALTER TABLE public.catalog_placements
  ADD CONSTRAINT catalog_placements_copy_index_check CHECK (copy_index BETWEEN 1 AND 2);

DROP INDEX IF EXISTS public.idx_catalog_placements_unique_alive;
CREATE UNIQUE INDEX idx_catalog_placements_unique_alive
  ON public.catalog_placements (catalog_track_id, managed_playlist_id, copy_index)
  WHERE status <> 'removed';

DROP INDEX IF EXISTS public.ux_catalog_placements_active_track_playlist;
CREATE UNIQUE INDEX ux_catalog_placements_active_track_playlist
  ON public.catalog_placements (catalog_track_id, managed_playlist_id, copy_index)
  WHERE status = 'active';

-- Ajusta os ON CONFLICT existentes para o novo alvo (todos inserem copy_index=1 por default)
DO $do$
DECLARE r record; v_def text;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'engine_create_distribution_plan',
        'engine_try_consume_target',
        'tg_managed_playlist_reactivate_catalog'
      )
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position('ON CONFLICT (catalog_track_id, managed_playlist_id) WHERE' in v_def) > 0 THEN
      v_def := replace(
        v_def,
        'ON CONFLICT (catalog_track_id, managed_playlist_id) WHERE',
        'ON CONFLICT (catalog_track_id, managed_playlist_id, copy_index) WHERE'
      );
      EXECUTE v_def;
    END IF;
  END LOOP;
END
$do$;

-- Executor: só ignora por "já presente" quando for a cópia 1
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
  v_has_campaign  boolean := false;
BEGIN
  SELECT cp.id, cp.status, cp.catalog_track_id, cp.managed_playlist_id, cp.copy_index
    INTO v_cp
  FROM public.catalog_placements cp WHERE cp.id = p_placement_id;
  IF v_cp.id IS NULL THEN
    RETURN jsonb_build_object('action','SKIP','reason','placement_not_found');
  END IF;
  IF v_cp.status NOT IN ('pending','processing','retry','skipped','waiting_circuit_breaker') THEN
    RETURN jsonb_build_object('action','SKIP','reason','status_not_executable:'||v_cp.status);
  END IF;

  SELECT ct.id, ct.spotify_track_id INTO v_ct
  FROM public.catalog_tracks ct WHERE ct.id = v_cp.catalog_track_id;
  IF v_ct.id IS NULL OR v_ct.spotify_track_id IS NULL OR v_ct.spotify_track_id = '' THEN
    RETURN jsonb_build_object('action','SKIP','reason','no_track_id');
  END IF;

  SELECT mp.id, mp.spotify_playlist_id, mp.playlist_type, mp.execution_mode,
         mp.operational_status, mp.genre_id, mp.owner_spotify_user_id
    INTO v_mp
  FROM public.managed_playlists mp WHERE mp.id = v_cp.managed_playlist_id;
  IF v_mp.id IS NULL THEN
    RETURN jsonb_build_object('action','SKIP','reason','playlist_not_found');
  END IF;
  IF v_mp.playlist_type = 'ARCHIVED'::public.playlist_type_enum THEN
    RETURN jsonb_build_object('action','SKIP','reason','playlist_archived');
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
      PERFORM 1 FROM public.spotify_circuit_breaker scb
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

  -- Cópia 1: presença bloqueia (protege contra duplicidade acidental).
  -- Cópia 2: duplicata pedida explicitamente pelo operador — segue para inserção.
  IF COALESCE(v_cp.copy_index, 1) = 1 THEN
    PERFORM 1 FROM public.managed_playlist_tracks mpt
    WHERE mpt.playlist_id = v_mp.id AND mpt.spotify_track_id = v_ct.spotify_track_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('action','SKIP','reason','already_present');
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_current_count
  FROM public.managed_playlist_tracks mpt WHERE mpt.playlist_id = v_mp.id;

  SELECT COALESCE(fp.operational_ceiling, 150) INTO v_planned_ceiling
  FROM public.fn_resolve_playlist_policy(v_mp.id) fp;

  IF v_current_count < v_planned_ceiling THEN
    RETURN jsonb_build_object('action','INSERT');
  END IF;

  SELECT mpt.spotify_track_id INTO v_victim_track
  FROM public.managed_playlist_tracks mpt
  LEFT JOIN public.v_playlist_track_origin o
    ON o.managed_playlist_id = mpt.playlist_id
   AND o.spotify_track_id   = mpt.spotify_track_id
  WHERE mpt.playlist_id = v_mp.id
    AND COALESCE(o.origin, 'ThirdParty') = 'ThirdParty'
  ORDER BY mpt.position DESC NULLS LAST
  LIMIT 1;

  IF v_victim_track IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.v_playlist_track_origin o
      WHERE o.managed_playlist_id = v_mp.id
        AND o.origin = 'Campaign'
    ) INTO v_has_campaign;

    IF v_has_campaign THEN
      RETURN jsonb_build_object('action','SKIP','reason','no_capacity_campaign_protected');
    END IF;
    RETURN jsonb_build_object('action','SKIP','reason','no_capacity_no_victim');
  END IF;

  RETURN jsonb_build_object('action','REMOVE_INSERT','remove_track_id', v_victim_track);
END;
$function$;

-- Envio direcionado a UMA playlist específica
CREATE OR REPLACE FUNCTION public.engine_place_catalog_track_on_playlist(
  p_track_id uuid,
  p_playlist_id uuid,
  p_allow_duplicate boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_track record;
  v_mp record;
  v_alive int := 0;
  v_present boolean := false;
  v_copy smallint;
  v_id uuid;
BEGIN
  SELECT id, status, spotify_track_id INTO v_track
  FROM public.catalog_tracks WHERE id = p_track_id;
  IF v_track.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'track_not_found');
  END IF;
  IF v_track.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'track_inactive');
  END IF;

  SELECT id, name, execution_mode, operational_status, playlist_type
    INTO v_mp
  FROM public.managed_playlists WHERE id = p_playlist_id;
  IF v_mp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'playlist_not_found');
  END IF;
  IF v_mp.playlist_type = 'ARCHIVED'::public.playlist_type_enum
     OR v_mp.execution_mode <> 'API_READY'::playlist_execution_mode
     OR COALESCE(v_mp.operational_status, '') = 'do_not_operate' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'playlist_not_operable');
  END IF;

  SELECT COUNT(*)::int INTO v_alive
  FROM public.catalog_placements cp
  WHERE cp.catalog_track_id = p_track_id
    AND cp.managed_playlist_id = p_playlist_id
    AND cp.status <> 'removed';

  v_present := v_alive > 0 OR EXISTS (
    SELECT 1 FROM public.managed_playlist_tracks mpt
    WHERE mpt.playlist_id = p_playlist_id
      AND mpt.spotify_track_id = v_track.spotify_track_id
  );

  IF v_present AND NOT p_allow_duplicate THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_present');
  END IF;

  IF v_alive >= 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max_copies_reached');
  END IF;

  v_copy := CASE WHEN v_alive = 0 THEN 1 ELSE 2 END;

  INSERT INTO public.catalog_placements (
    catalog_track_id, managed_playlist_id, status, origin, priority, scheduled_for, copy_index
  ) VALUES (
    p_track_id, p_playlist_id, 'pending', 'MANUAL', 1, now(), v_copy
  )
  ON CONFLICT (catalog_track_id, managed_playlist_id, copy_index) WHERE status <> 'removed'
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'placement_conflict');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'placement_id', v_id,
    'copy_index', v_copy,
    'duplicate', v_present,
    'playlist_name', v_mp.name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.engine_place_catalog_track_on_playlist(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.engine_place_catalog_track_on_playlist(uuid, uuid, boolean) TO service_role;