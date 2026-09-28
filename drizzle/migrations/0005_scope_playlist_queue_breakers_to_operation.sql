CREATE OR REPLACE FUNCTION public.claim_next_catalog_placements(_worker text, _limit integer DEFAULT 50)
 RETURNS SETOF catalog_placements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date;
  v_max_global integer; v_max_owner integer; v_max_app integer;
  v_res_global integer; v_res_owner integer; v_res_app integer;
  v_cat_global integer; v_cat_owner integer; v_cat_app integer;
  v_done_cat integer; v_done_camp integer;
  v_rem_cat integer; v_rem_camp integer;
  v_effective integer;
BEGIN
  PERFORM public.fn_sanitize_catalog_pending(2000);

  SELECT COALESCE(catalog_max_daily_distributions, 400), COALESCE(catalog_max_daily_per_owner, 300), COALESCE(catalog_max_daily_per_app, 800),
         COALESCE(campaign_reserved_daily_global, 0), COALESCE(campaign_reserved_daily_per_owner, 0), COALESCE(campaign_reserved_daily_per_app, 0)
    INTO v_max_global, v_max_owner, v_max_app, v_res_global, v_res_owner, v_res_app
  FROM public.system_flags ORDER BY id LIMIT 1;

  v_res_global := LEAST(v_res_global, v_max_global);
  v_res_owner  := LEAST(v_res_owner,  v_max_owner);
  v_res_app    := LEAST(v_res_app,    v_max_app);
  v_cat_global := v_max_global - v_res_global;
  v_cat_owner  := v_max_owner  - v_res_owner;
  v_cat_app    := v_max_app    - v_res_app;

  v_today := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  SELECT COALESCE(max(count) FILTER (WHERE scope='GLOBAL'),0), COALESCE(max(count) FILTER (WHERE scope='CAMPAIGN_GLOBAL'),0)
    INTO v_done_cat, v_done_camp
  FROM public.catalog_distribution_counters
  WHERE day = v_today AND scope IN ('GLOBAL','CAMPAIGN_GLOBAL') AND scope_id = '';

  v_rem_cat  := GREATEST(0, v_cat_global - v_done_cat);
  v_rem_camp := GREATEST(0, v_res_global - v_done_camp);
  IF v_rem_cat + v_rem_camp <= 0 THEN RETURN; END IF;

  v_effective := LEAST(GREATEST(1, _limit), v_rem_cat + v_rem_camp, 500);

  RETURN QUERY
  WITH base AS (
    SELECT cp.id, cp.status AS prev_status, cp.catalog_track_id, cp.priority, cp.scheduled_for, cp.created_at,
           (cp.origin = 'CATALOG') AS is_cat,
           mp.owner_spotify_user_id AS owner_id, sut.app_id::text AS app_id
    FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    JOIN public.catalog_tracks    ct ON ct.id = cp.catalog_track_id
    JOIN public.spotify_user_tokens sut
      ON sut.spotify_user_id = mp.owner_spotify_user_id
     AND sut.refresh_token IS NOT NULL AND sut.refresh_token <> ''
    WHERE cp.status IN ('pending','retry','waiting_circuit_breaker','skipped')
      AND cp.scheduled_for <= now()
      AND cp.attempts < cp.max_attempts
      AND mp.playlist_type IN ('CAMPAIGN'::public.playlist_type_enum, 'CATALOG'::public.playlist_type_enum)
      AND mp.execution_mode = 'API_READY'::playlist_execution_mode
      AND mp.spotify_playlist_id IS NOT NULL AND mp.spotify_playlist_id <> ''
      AND ct.spotify_track_id   IS NOT NULL AND ct.spotify_track_id   <> ''
      AND NOT public.is_spotify_account_paused(mp.owner_spotify_user_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.spotify_circuit_breaker scb
        WHERE scb.app_id = sut.app_id::text
          AND scb.context = 'operation'
          AND scb.status = 'open'
          AND (scb.blocked_until IS NULL OR scb.blocked_until > now())
      )
  ),
  enriched AS (
    SELECT b.*,
      COALESCE(co.count, 0) AS owner_count_today,
      COALESCE(ca.count, 0) AS app_count_today
    FROM base b
    LEFT JOIN public.catalog_distribution_counters co
      ON co.day = v_today AND co.scope = CASE WHEN b.is_cat THEN 'OWNER' ELSE 'CAMPAIGN_OWNER' END AND co.scope_id = b.owner_id
    LEFT JOIN public.catalog_distribution_counters ca
      ON ca.day = v_today AND ca.scope = CASE WHEN b.is_cat THEN 'APP' ELSE 'CAMPAIGN_APP' END AND ca.scope_id = b.app_id
    WHERE (b.is_cat AND v_rem_cat > 0 AND COALESCE(co.count,0) < v_cat_owner AND COALESCE(ca.count,0) < v_cat_app)
       OR (NOT b.is_cat AND v_rem_camp > 0 AND COALESCE(co.count,0) < v_res_owner AND COALESCE(ca.count,0) < v_res_app)
  ),
  ordered AS (
    SELECT e.*,
      ROW_NUMBER() OVER (PARTITION BY e.catalog_track_id ORDER BY e.priority ASC, e.scheduled_for ASC, e.created_at ASC) AS rn_track,
      ROW_NUMBER() OVER (PARTITION BY e.is_cat ORDER BY e.priority ASC, e.scheduled_for ASC, e.created_at ASC) AS rn_flow
    FROM enriched e
  ),
  eligible AS (
    SELECT o.id, o.prev_status
    FROM ordered o
    JOIN public.catalog_placements cp ON cp.id = o.id
    WHERE (o.is_cat AND o.rn_flow <= v_rem_cat) OR (NOT o.is_cat AND o.rn_flow <= v_rem_camp)
    ORDER BY o.priority ASC, o.rn_track ASC, o.owner_count_today ASC, o.app_count_today ASC, o.scheduled_for ASC, o.created_at ASC
    LIMIT v_effective
    FOR UPDATE OF cp SKIP LOCKED
  )
  UPDATE public.catalog_placements p
  SET status = 'processing', locked_at = now(), locked_by = _worker,
      lease_expires_at = now() + interval '2 minutes',
      attempts = CASE WHEN eligible.prev_status IN ('waiting_circuit_breaker','skipped') THEN p.attempts ELSE p.attempts + 1 END
  FROM eligible
  WHERE p.id = eligible.id
  RETURNING p.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sanitize_catalog_pending(p_limit integer DEFAULT 2000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_blocked_archived int := 0;
  v_blocked_manual int := 0;
  v_blocked_disabled int := 0;
  v_blocked_no_pl int := 0;
  v_blocked_no_track int := 0;
  v_blocked_maxed int := 0;
  v_resched_no_oauth int := 0;
  v_resched_breaker int := 0;
BEGIN
  WITH cand AS (
    SELECT cp.id FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    WHERE cp.status='pending' AND mp.playlist_type='ARCHIVED'::public.playlist_type_enum
    LIMIT p_limit
  )
  UPDATE public.catalog_placements cp SET status='blocked', last_error_code='playlist_archived', skip_reason='playlist_archived', skipped_at=now(), updated_at=now()
  FROM cand WHERE cp.id=cand.id;
  GET DIAGNOSTICS v_blocked_archived=ROW_COUNT;

  WITH cand AS (
    SELECT cp.id FROM public.catalog_placements cp JOIN public.managed_playlists mp ON mp.id=cp.managed_playlist_id
    WHERE cp.status='pending' AND mp.execution_mode='MANUAL_ONLY'::playlist_execution_mode
  )
  UPDATE public.catalog_placements cp SET status='blocked', last_error_code='manual_only', skip_reason='manual_only', skipped_at=now(), updated_at=now()
  FROM cand WHERE cp.id=cand.id;
  GET DIAGNOSTICS v_blocked_manual=ROW_COUNT;

  WITH cand AS (
    SELECT cp.id FROM public.catalog_placements cp JOIN public.managed_playlists mp ON mp.id=cp.managed_playlist_id
    WHERE cp.status='pending' AND mp.execution_mode='DISABLED'::playlist_execution_mode AND mp.playlist_type<>'ARCHIVED'::public.playlist_type_enum
  )
  UPDATE public.catalog_placements cp SET status='blocked', last_error_code='playlist_disabled', skip_reason='playlist_disabled', skipped_at=now(), updated_at=now()
  FROM cand WHERE cp.id=cand.id;
  GET DIAGNOSTICS v_blocked_disabled=ROW_COUNT;

  WITH cand AS (
    SELECT cp.id FROM public.catalog_placements cp JOIN public.managed_playlists mp ON mp.id=cp.managed_playlist_id
    WHERE cp.status='pending' AND (mp.spotify_playlist_id IS NULL OR mp.spotify_playlist_id='')
  )
  UPDATE public.catalog_placements cp SET status='blocked', last_error_code='no_spotify_playlist_id', skip_reason='no_spotify_playlist_id', skipped_at=now(), updated_at=now()
  FROM cand WHERE cp.id=cand.id;
  GET DIAGNOSTICS v_blocked_no_pl=ROW_COUNT;

  WITH cand AS (
    SELECT cp.id FROM public.catalog_placements cp JOIN public.catalog_tracks ct ON ct.id=cp.catalog_track_id
    WHERE cp.status='pending' AND (ct.spotify_track_id IS NULL OR ct.spotify_track_id='')
  )
  UPDATE public.catalog_placements cp SET status='blocked', last_error_code='no_spotify_track_id', skip_reason='no_spotify_track_id', skipped_at=now(), updated_at=now()
  FROM cand WHERE cp.id=cand.id;
  GET DIAGNOSTICS v_blocked_no_track=ROW_COUNT;

  UPDATE public.catalog_placements SET status='blocked', last_error_code='max_attempts_reached', skip_reason='max_attempts_reached', skipped_at=now(), updated_at=now()
  WHERE status='pending' AND attempts>=max_attempts;
  GET DIAGNOSTICS v_blocked_maxed=ROW_COUNT;

  WITH cand AS (
    SELECT cp.id FROM public.catalog_placements cp JOIN public.managed_playlists mp ON mp.id=cp.managed_playlist_id
    WHERE cp.status='pending' AND cp.scheduled_for<=now() AND mp.owner_spotify_user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.spotify_user_tokens sut WHERE sut.spotify_user_id=mp.owner_spotify_user_id AND sut.refresh_token IS NOT NULL AND sut.refresh_token<>'')
  )
  UPDATE public.catalog_placements cp SET scheduled_for=now()+interval '30 minutes', last_error_code='awaiting_oauth', updated_at=now()
  FROM cand WHERE cp.id=cand.id;
  GET DIAGNOSTICS v_resched_no_oauth=ROW_COUNT;

  WITH cand AS (
    SELECT cp.id, COALESCE(scb.blocked_until,now()+interval '5 minutes') AS until_ts
    FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id=cp.managed_playlist_id
    JOIN LATERAL (
      SELECT sut.app_id FROM public.spotify_user_tokens sut
      WHERE sut.spotify_user_id=mp.owner_spotify_user_id AND sut.refresh_token IS NOT NULL AND sut.refresh_token<>''
      ORDER BY sut.is_default DESC NULLS LAST, sut.updated_at DESC NULLS LAST LIMIT 1
    ) tok ON true
    JOIN public.spotify_circuit_breaker scb ON scb.app_id=tok.app_id::text
      AND scb.context='operation'
      AND scb.status='open'
      AND (scb.blocked_until IS NULL OR scb.blocked_until>now())
    WHERE cp.status='pending' AND cp.scheduled_for<=now()
  )
  UPDATE public.catalog_placements cp SET scheduled_for=cand.until_ts, last_error_code='circuit_breaker_open', updated_at=now()
  FROM cand WHERE cp.id=cand.id;
  GET DIAGNOSTICS v_resched_breaker=ROW_COUNT;

  RETURN jsonb_build_object('blocked_archived',v_blocked_archived,'blocked_manual_only',v_blocked_manual,'blocked_disabled',v_blocked_disabled,'blocked_no_spotify_playlist',v_blocked_no_pl,'blocked_no_spotify_track',v_blocked_no_track,'blocked_max_attempts',v_blocked_maxed,'rescheduled_no_oauth',v_resched_no_oauth,'rescheduled_circuit_breaker',v_resched_breaker);
END;
$function$;