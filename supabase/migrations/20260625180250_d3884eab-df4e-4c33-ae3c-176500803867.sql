
-- =====================================================================
-- Occupancy Engine — event-driven only (no auto cleanup / overflow)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_playlist_occupancy_rebuild(
  p_playlist_id uuid,
  p_mode text DEFAULT 'SHADOW',
  p_trigger_source text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id uuid;
  v_policy record;
  v_policy_src text;
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
BEGIN
  IF p_mode NOT IN ('SHADOW','DUAL_WRITE','PRIMARY') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode;
  END IF;

  SELECT * INTO v_policy FROM public.fn_resolve_playlist_policy(p_playlist_id);
  IF v_policy IS NULL OR v_policy.managed_playlist_id IS NULL THEN
    RAISE EXCEPTION 'playlist % não encontrada', p_playlist_id;
  END IF;
  v_policy_src := v_policy.source;

  -- Classify event. ONLY insertion/free-slot events can produce ops.
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
    CASE WHEN v_policy_src = 'missing' THEN 'blocked' ELSE 'draft' END,
    to_jsonb(v_policy),
    p_trigger_source
  ) RETURNING id INTO v_plan_id;

  IF v_policy_src = 'missing' THEN
    UPDATE public.occupancy_plans
       SET block_reason='policy_missing', finalized_at=now()
     WHERE id=v_plan_id;
    INSERT INTO public.playlist_policy_alerts (managed_playlist_id, alert_type, severity, message, details)
    VALUES (p_playlist_id, 'policy_missing', 'warning',
            'Playlist sem política editorial; engine bloqueado.',
            jsonb_build_object('plan_id', v_plan_id));
    RETURN v_plan_id;
  END IF;

  -- Snapshot of current state (used only when event allows action)
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
             'reason', 'event_does_not_require_action'
           )
     WHERE id = v_plan_id;
    RETURN v_plan_id;
  END IF;

  -- INSERTION_DRIVEN: process pending catalog placements one by one.
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
      -- Free slot available: only INSERT.
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

    -- No free slot: pick exactly ONE victim.
    -- Priority: ThirdParty (highest position) -> Catalog (highest position, only if catalog over capacity).
    -- NEVER touch Campaign.
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
      -- No removable victim (only Campaign present, or Catalog within capacity).
      -- Spec: do nothing. Stop here.
      EXIT;
    END IF;

    -- 1 REMOVE + 1 INSERT
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

    -- Mirror in _cur
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
           'pending_processed', v_processed,
           'inserts', v_inserts,
           'removes', v_removes
         )
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END;
$function$;

-- Updated queue processor: forward trigger_source to rebuild.
CREATE OR REPLACE FUNCTION public.fn_process_occupancy_rebuild_queue(p_limit integer DEFAULT 20)
RETURNS TABLE(queue_id uuid, playlist_id uuid, result_status text, plan_id uuid, ops integer, duration_ms integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_plan uuid; v_ops int; v_started timestamptz; v_dur int; v_lock_key bigint;
  v_flag text; v_mode text;
BEGIN
  SELECT occupancy_engine_mode INTO v_flag FROM public.system_flags LIMIT 1;
  v_mode := CASE upper(COALESCE(v_flag,'shadow'))
              WHEN 'DUAL_WRITE' THEN 'DUAL_WRITE'
              WHEN 'PRIMARY'    THEN 'PRIMARY'
              ELSE 'SHADOW'
            END;

  FOR r IN
    SELECT q.id AS qid, q.managed_playlist_id AS pl, q.trigger_source AS src
      FROM public.occupancy_rebuild_queue q
     WHERE q.status = 'pending'
     ORDER BY q.enqueued_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    v_lock_key := ('x' || substr(md5(r.pl::text),1,16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
      UPDATE public.occupancy_rebuild_queue
         SET status='skipped_lock', finished_at=now(), last_error='lock_busy'
       WHERE id = r.qid;
      queue_id := r.qid; playlist_id := r.pl; result_status := 'skipped_lock';
      plan_id := NULL; ops := 0; duration_ms := 0;
      RETURN NEXT; CONTINUE;
    END IF;

    UPDATE public.occupancy_rebuild_queue
       SET status='processing', started_at=now(), attempts=attempts+1
     WHERE id = r.qid;
    v_started := clock_timestamp();

    BEGIN
      v_plan := public.fn_playlist_occupancy_rebuild(r.pl, v_mode, r.src);
      v_dur  := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_started))::int;
      SELECT count(*)::int INTO v_ops FROM public.occupancy_plan_ops o WHERE o.plan_id = v_plan;
      UPDATE public.occupancy_plans p
         SET trigger_source = COALESCE(p.trigger_source, r.src),
             started_at     = v_started,
             duration_ms    = v_dur,
             ops_count      = COALESCE(v_ops,0),
             finalized_at   = COALESCE(p.finalized_at, now())
       WHERE p.id = v_plan;
      UPDATE public.occupancy_rebuild_queue
         SET status = CASE WHEN COALESCE(v_ops,0)=0 THEN 'no_change' ELSE 'done' END,
             plan_id = v_plan, finished_at = now()
       WHERE id = r.qid;
      queue_id := r.qid; playlist_id := r.pl;
      result_status := CASE WHEN COALESCE(v_ops,0)=0 THEN 'no_change' ELSE 'done' END;
      plan_id := v_plan; ops := COALESCE(v_ops,0); duration_ms := v_dur;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      v_dur := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_started))::int;
      UPDATE public.occupancy_rebuild_queue
         SET status='error', last_error=SQLERRM, finished_at=now()
       WHERE id = r.qid;
      queue_id := r.qid; playlist_id := r.pl; result_status := 'error';
      plan_id := NULL; ops := 0; duration_ms := v_dur;
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$;
