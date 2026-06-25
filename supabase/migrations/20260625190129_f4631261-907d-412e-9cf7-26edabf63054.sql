
-- =====================================================================
-- OCCUPANCY ENGINE — UNIVERSO DE DISTRIBUIÇÃO OFICIAL
-- Regra nova: archived_at e execution_mode=DISABLED não bloqueiam mais.
-- Bloqueio operacional restrito a:
--   * MANUAL_ONLY
--   * operational_status = 'do_not_operate'
--   * sem spotify_playlist_id
-- =====================================================================
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
  v_event_class text;
  v_total_current integer := 0;
  v_third_count integer := 0;
  v_campaign_count integer := 0;
  v_catalog_count integer := 0;
  v_cap_total integer := 0;
  v_max_substitutions constant integer := 5;
  v_pending record;
  v_victim_track text;
  v_victim_pos integer;
  v_victim_origin text;
  v_inserts integer := 0;
  v_removes integer := 0;
  v_processed integer := 0;
  v_insert_pos integer;
  v_mp record;
  v_block_reason text := NULL;
BEGIN
  IF p_mode NOT IN ('SHADOW','DUAL_WRITE','PRIMARY') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode;
  END IF;

  SELECT mp.id, mp.spotify_playlist_id, mp.archived_at, mp.execution_mode,
         mp.operational_status, mp.genre_id
    INTO v_mp
  FROM public.managed_playlists mp
  WHERE mp.id = p_playlist_id;

  IF v_mp.id IS NULL THEN
    RAISE EXCEPTION 'playlist % nao encontrada', p_playlist_id;
  END IF;

  -- Regra OFICIAL do universo de distribuicao.
  -- archived_at NAO bloqueia mais (classificacao historica).
  -- execution_mode=DISABLED NAO bloqueia mais (era apenas side-effect do archive).
  v_block_reason := CASE
    WHEN v_mp.spotify_playlist_id IS NULL OR v_mp.spotify_playlist_id = '' THEN 'no_spotify_id'
    WHEN v_mp.execution_mode = 'MANUAL_ONLY'::playlist_execution_mode THEN 'manual_only'
    WHEN COALESCE(v_mp.operational_status,'') = 'do_not_operate' THEN 'do_not_operate'
    ELSE NULL
  END;

  SELECT * INTO v_policy FROM public.fn_resolve_playlist_policy(p_playlist_id);

  v_event_class := CASE
    WHEN p_trigger_source IN (
      'catalog_placement_insert',
      'catalog_placement_update',
      'catalog_insert',
      'campaign_closed',
      'managed_tracks_delete',
      'manual_remove',
      'free_slot_available'
    ) THEN 'INSERTION_DRIVEN'
    ELSE 'NO_OP'
  END;

  INSERT INTO public.occupancy_plans (managed_playlist_id, mode, status, policy_snapshot, trigger_source)
  VALUES (
    p_playlist_id, p_mode,
    CASE WHEN v_block_reason IS NOT NULL THEN 'blocked' ELSE 'draft' END,
    to_jsonb(v_policy),
    p_trigger_source
  ) RETURNING id INTO v_plan_id;

  IF v_block_reason IS NOT NULL THEN
    UPDATE public.occupancy_plans
       SET block_reason = v_block_reason, finalized_at = now()
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
  v_cap_total := v_policy.campaign_reserved_slots + v_policy.catalog_capacity;

  IF v_event_class = 'NO_OP' THEN
    UPDATE public.occupancy_plans
       SET status='ready', finalized_at=now(),
           stats = jsonb_build_object(
             'total_current', v_total_current,
             'campaign_count', v_campaign_count,
             'catalog_count', v_catalog_count,
             'third_party_count', v_third_count,
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
     ORDER BY cp.created_at ASC
     LIMIT v_max_substitutions
  LOOP
    v_processed := v_processed + 1;

    IF v_total_current < v_cap_total THEN
      v_insert_pos := v_total_current;
      INSERT INTO public.occupancy_plan_ops (
        plan_id, op_type, spotify_track_id, classification, to_position, reason
      ) VALUES (
        v_plan_id, 'INSERT', v_pending.spotify_track_id, 'Catalog',
        v_insert_pos, 'fill_free_slot'
      );
      INSERT INTO _cur (spotify_track_id, position, origin)
      VALUES (v_pending.spotify_track_id, v_insert_pos, 'Catalog');
      v_total_current := v_total_current + 1;
      v_catalog_count := v_catalog_count + 1;
      v_inserts := v_inserts + 1;
      CONTINUE;
    END IF;

    v_victim_track := NULL; v_victim_pos := NULL; v_victim_origin := NULL;

    SELECT spotify_track_id, position, origin
      INTO v_victim_track, v_victim_pos, v_victim_origin
      FROM _cur
     WHERE origin = 'ThirdParty'
     ORDER BY position DESC
     LIMIT 1;

    IF v_victim_track IS NULL AND v_catalog_count > v_policy.catalog_capacity THEN
      SELECT spotify_track_id, position, origin
        INTO v_victim_track, v_victim_pos, v_victim_origin
        FROM _cur
       WHERE origin = 'Catalog'
       ORDER BY position DESC
       LIMIT 1;
    END IF;

    IF v_victim_track IS NULL THEN
      EXIT;
    END IF;

    INSERT INTO public.occupancy_plan_ops (
      plan_id, op_type, spotify_track_id, classification, from_position, reason
    ) VALUES (
      v_plan_id, 'REMOVE', v_victim_track, v_victim_origin, v_victim_pos,
      'substitution_for_catalog_insert'
    );
    INSERT INTO public.occupancy_plan_ops (
      plan_id, op_type, spotify_track_id, classification, to_position, reason
    ) VALUES (
      v_plan_id, 'INSERT', v_pending.spotify_track_id, 'Catalog',
      v_victim_pos, 'substitution_for_catalog_insert'
    );

    DELETE FROM _cur WHERE spotify_track_id = v_victim_track;
    IF v_victim_origin = 'ThirdParty' THEN v_third_count := v_third_count - 1;
    ELSIF v_victim_origin = 'Catalog' THEN v_catalog_count := v_catalog_count - 1;
    END IF;
    INSERT INTO _cur (spotify_track_id, position, origin)
    VALUES (v_pending.spotify_track_id, v_victim_pos, 'Catalog');
    v_catalog_count := v_catalog_count + 1;
    v_removes := v_removes + 1;
    v_inserts := v_inserts + 1;
  END LOOP;

  UPDATE public.occupancy_plans
     SET status='ready', finalized_at=now(),
         stats = jsonb_build_object(
           'total_current', v_total_current,
           'campaign_count', v_campaign_count,
           'catalog_count', v_catalog_count,
           'third_party_count', v_third_count,
           'cap_total', v_cap_total,
           'event_class', v_event_class,
           'trigger_source', p_trigger_source,
           'policy_source', v_policy.source,
           'pending_processed', v_processed,
           'inserts', v_inserts,
           'removes', v_removes
         )
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END;
$function$;
