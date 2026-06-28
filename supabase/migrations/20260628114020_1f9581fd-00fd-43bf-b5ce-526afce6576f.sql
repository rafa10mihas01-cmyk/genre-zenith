
CREATE OR REPLACE FUNCTION public.fn_playlist_occupancy_rebuild(
  p_playlist_id uuid,
  p_mode text DEFAULT 'SHADOW'::text,
  p_trigger_source text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id uuid;
  v_policy record;
  v_mp record;
  v_block_reason text := NULL;
  v_event_class text;

  v_owner_app_id uuid;
  v_breaker_open boolean := false;
  v_breaker_blocked_until timestamptz;
  v_owner_has_token boolean := false;

  v_total_current   integer := 0;
  v_campaign_count  integer := 0;
  v_catalog_count   integer := 0;
  v_third_count     integer := 0;

  v_planned_ceiling   integer := 150;
  v_effective_ceiling integer := 150;
  v_free_slots        integer := 0;
  v_mode_branch       text;

  v_max_substitutions constant integer := 5;
  v_pending record;
  v_victim_track text;
  v_victim_pos integer;
  v_insert_pos integer;
  v_inserts integer := 0;
  v_removes integer := 0;
  v_processed integer := 0;

  -- Pre-check vars
  v_eligible_placements integer := 0;
  v_current_count       integer := 0;
  v_third_party_count   integer := 0;
  v_precheck_skip_reason text := NULL;
BEGIN
  IF p_mode NOT IN ('SHADOW','DUAL_WRITE','PRIMARY') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode;
  END IF;

  SELECT mp.id, mp.spotify_playlist_id, mp.archived_at, mp.execution_mode,
         mp.operational_status, mp.genre_id, mp.owner_spotify_user_id
    INTO v_mp
  FROM public.managed_playlists mp
  WHERE mp.id = p_playlist_id;

  IF v_mp.id IS NULL THEN
    RAISE EXCEPTION 'playlist % nao encontrada', p_playlist_id;
  END IF;

  -- Resolve owner app + breaker (necessário para pré-checagem)
  IF v_mp.owner_spotify_user_id IS NOT NULL THEN
    SELECT sut.app_id INTO v_owner_app_id
    FROM public.spotify_user_tokens sut
    WHERE sut.spotify_user_id = v_mp.owner_spotify_user_id
    ORDER BY sut.is_default DESC NULLS LAST, sut.updated_at DESC NULLS LAST
    LIMIT 1;

    IF v_owner_app_id IS NOT NULL THEN
      v_owner_has_token := true;
      SELECT scb.blocked_until INTO v_breaker_blocked_until
      FROM public.spotify_circuit_breaker scb
      WHERE scb.app_id = v_owner_app_id::text
        AND scb.context = 'operation'
        AND scb.status = 'open'
        AND (scb.blocked_until IS NULL OR scb.blocked_until > now())
      LIMIT 1;
      IF FOUND THEN v_breaker_open := true; END IF;
    END IF;
  END IF;

  v_event_class := CASE
    WHEN p_trigger_source IN (
      'catalog_placement_insert','catalog_placement_update','catalog_insert',
      'campaign_closed','managed_tracks_delete','manual_remove','free_slot_available'
    ) THEN 'INSERTION_DRIVEN'
    ELSE 'NO_OP'
  END;

  -- =========================================================================
  -- PRÉ-CHECAGEM (arquitetura oficial): se já é possível provar antes do
  -- rebuild que não existe ação útil, abortar sem criar occupancy_plan.
  -- =========================================================================
  IF v_mp.archived_at IS NOT NULL THEN
    v_precheck_skip_reason := 'archived';
  ELSIF v_mp.spotify_playlist_id IS NULL OR v_mp.spotify_playlist_id = '' THEN
    v_precheck_skip_reason := 'no_spotify_id';
  ELSIF v_mp.execution_mode = 'MANUAL_ONLY'::playlist_execution_mode THEN
    v_precheck_skip_reason := 'manual_only';
  ELSIF COALESCE(v_mp.operational_status,'') = 'do_not_operate' THEN
    v_precheck_skip_reason := 'do_not_operate';
  ELSIF v_breaker_open THEN
    v_precheck_skip_reason := 'circuit_open';
  ELSIF v_mp.owner_spotify_user_id IS NOT NULL AND NOT v_owner_has_token THEN
    v_precheck_skip_reason := 'no_oauth_token';
  ELSIF v_event_class = 'INSERTION_DRIVEN' THEN
    -- Quantos placements elegíveis (active e ainda não na playlist)
    SELECT COUNT(*) INTO v_eligible_placements
    FROM public.catalog_placements cp
    JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
    WHERE cp.managed_playlist_id = p_playlist_id
      AND cp.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.managed_playlist_tracks mpt
         WHERE mpt.playlist_id = p_playlist_id
           AND mpt.spotify_track_id = ct.spotify_track_id
      );

    IF v_eligible_placements = 0 THEN
      v_precheck_skip_reason := 'no_eligible_placement';
    ELSE
      -- Verifica vaga real (free slot) OU vítima ThirdParty
      SELECT COUNT(*) INTO v_current_count
      FROM public.managed_playlist_tracks mpt
      WHERE mpt.playlist_id = p_playlist_id;

      SELECT COALESCE(fp.operational_ceiling, 150) INTO v_planned_ceiling
      FROM public.fn_resolve_playlist_policy(p_playlist_id) fp;

      IF v_current_count < v_planned_ceiling THEN
        -- Há vaga abaixo do teto: rebuild necessário
        NULL;
      ELSE
        SELECT COUNT(*) INTO v_third_party_count
        FROM public.managed_playlist_tracks mpt
        LEFT JOIN public.v_playlist_track_origin o
          ON o.managed_playlist_id = mpt.playlist_id
         AND o.spotify_track_id   = mpt.spotify_track_id
        WHERE mpt.playlist_id = p_playlist_id
          AND COALESCE(o.origin,'ThirdParty') = 'ThirdParty';

        IF v_third_party_count = 0 THEN
          v_precheck_skip_reason := 'no_slot_no_victim';
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_precheck_skip_reason IS NOT NULL THEN
    -- Skip silencioso: nenhum occupancy_plan criado. Triggers existentes
    -- reenfileiram quando estado mudar (insert/remove/policy/campaign).
    RETURN NULL;
  END IF;
  -- =========================================================================
  -- Fim da pré-checagem
  -- =========================================================================

  v_block_reason := CASE
    WHEN v_mp.spotify_playlist_id IS NULL OR v_mp.spotify_playlist_id = '' THEN 'no_spotify_id'
    WHEN v_mp.execution_mode = 'MANUAL_ONLY'::playlist_execution_mode THEN 'manual_only'
    WHEN COALESCE(v_mp.operational_status,'') = 'do_not_operate' THEN 'do_not_operate'
    WHEN v_breaker_open THEN 'circuit_open'
    ELSE NULL
  END;

  SELECT * INTO v_policy FROM public.fn_resolve_playlist_policy(p_playlist_id);
  v_planned_ceiling := COALESCE(v_policy.operational_ceiling, 150);

  INSERT INTO public.occupancy_plans (managed_playlist_id, mode, status, policy_snapshot, trigger_source)
  VALUES (
    p_playlist_id, p_mode,
    CASE WHEN v_block_reason IS NOT NULL THEN 'blocked' ELSE 'draft' END,
    to_jsonb(v_policy),
    p_trigger_source
  ) RETURNING id INTO v_plan_id;

  IF v_block_reason IS NOT NULL THEN
    UPDATE public.occupancy_plans
       SET block_reason = v_block_reason,
           finalized_at = now(),
           stats = jsonb_build_object(
             'block_reason', v_block_reason,
             'owner_spotify_user_id', v_mp.owner_spotify_user_id,
             'owner_app_id', v_owner_app_id,
             'breaker_blocked_until', v_breaker_blocked_until,
             'trigger_source', p_trigger_source,
             'event_class', 'GATED'
           )
     WHERE id = v_plan_id;
    RETURN v_plan_id;
  END IF;

  DROP TABLE IF EXISTS _cur;
  CREATE TEMP TABLE _cur ON COMMIT DROP AS
  SELECT
    mpt.spotify_track_id,
    mpt.position,
    COALESCE(o.origin, 'ThirdParty') AS origin
  FROM public.managed_playlist_tracks mpt
  LEFT JOIN public.v_playlist_track_origin o
    ON o.managed_playlist_id = mpt.playlist_id
   AND o.spotify_track_id   = mpt.spotify_track_id
  WHERE mpt.playlist_id = p_playlist_id;

  SELECT count(*) INTO v_total_current FROM _cur;
  SELECT count(*) INTO v_campaign_count FROM _cur WHERE origin='Campaign';
  SELECT count(*) INTO v_catalog_count  FROM _cur WHERE origin='Catalog';
  SELECT count(*) INTO v_third_count    FROM _cur WHERE origin='ThirdParty';

  v_effective_ceiling := GREATEST(v_planned_ceiling, v_total_current);
  v_free_slots        := GREATEST(0, v_effective_ceiling - v_total_current);
  v_mode_branch       := CASE
    WHEN v_total_current <  v_planned_ceiling THEN 'below_ceiling'
    WHEN v_total_current =  v_planned_ceiling THEN 'at_ceiling'
    ELSE 'above_ceiling'
  END;

  IF v_event_class = 'NO_OP' THEN
    UPDATE public.occupancy_plans
       SET status='ready', finalized_at=now(),
           stats = jsonb_build_object(
             'total_current', v_total_current,
             'campaign_count', v_campaign_count,
             'catalog_count', v_catalog_count,
             'third_party_count', v_third_count,
             'planned_ceiling', v_planned_ceiling,
             'effective_ceiling', v_effective_ceiling,
             'free_slots', v_free_slots,
             'mode_branch', v_mode_branch,
             'event_class', 'NO_OP',
             'trigger_source', p_trigger_source,
             'policy_source', v_policy.source,
             'reason', 'event_does_not_require_action'
           )
     WHERE id = v_plan_id;
    RETURN v_plan_id;
  END IF;

  FOR v_pending IN
    SELECT ct.spotify_track_id
      FROM public.catalog_placements cp
      JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
     WHERE cp.managed_playlist_id = p_playlist_id
       AND cp.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM _cur c WHERE c.spotify_track_id = ct.spotify_track_id)
     ORDER BY cp.created_at NULLS LAST
  LOOP
    IF v_free_slots > 0 THEN
      v_insert_pos := v_total_current + 1;
      INSERT INTO public.occupancy_plan_ops
        (plan_id, op_type, spotify_track_id, position, reason, payload)
      VALUES
        (v_plan_id, 'INSERT', v_pending.spotify_track_id, v_insert_pos, 'fill_free_slot', '{}'::jsonb);
      v_total_current := v_total_current + 1;
      v_free_slots := v_free_slots - 1;
      v_inserts := v_inserts + 1;
    ELSIF v_processed < v_max_substitutions THEN
      SELECT c.spotify_track_id, c.position
        INTO v_victim_track, v_victim_pos
      FROM _cur c
      WHERE c.origin = 'ThirdParty'
      ORDER BY c.position DESC NULLS LAST
      LIMIT 1;

      IF v_victim_track IS NULL THEN EXIT; END IF;

      INSERT INTO public.occupancy_plan_ops
        (plan_id, op_type, spotify_track_id, position, reason, payload)
      VALUES
        (v_plan_id, 'REMOVE', v_victim_track, v_victim_pos, 'replace_third_party', '{}'::jsonb);

      DELETE FROM _cur WHERE spotify_track_id = v_victim_track;
      v_removes := v_removes + 1;

      v_insert_pos := v_total_current;
      INSERT INTO public.occupancy_plan_ops
        (plan_id, op_type, spotify_track_id, position, reason, payload)
      VALUES
        (v_plan_id, 'INSERT', v_pending.spotify_track_id, v_insert_pos, 'replace_third_party', '{}'::jsonb);

      v_inserts := v_inserts + 1;
      v_processed := v_processed + 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;

  UPDATE public.occupancy_plans
     SET status = 'ready',
         finalized_at = now(),
         stats = jsonb_build_object(
           'total_current', v_total_current,
           'campaign_count', v_campaign_count,
           'catalog_count', v_catalog_count,
           'third_party_count', v_third_count,
           'planned_ceiling', v_planned_ceiling,
           'effective_ceiling', v_effective_ceiling,
           'free_slots', v_free_slots,
           'mode_branch', v_mode_branch,
           'inserts', v_inserts,
           'removes', v_removes,
           'substitutions', v_processed,
           'event_class', v_event_class,
           'trigger_source', p_trigger_source,
           'policy_source', v_policy.source
         )
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END;
$function$;
