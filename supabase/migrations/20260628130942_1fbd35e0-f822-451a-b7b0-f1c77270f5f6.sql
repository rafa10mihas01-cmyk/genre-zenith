
-- =====================================================================
-- ETAPA: Filtro de elegibilidade DENTRO do claim. Executor deixa de
-- gastar ticks com playlists impossíveis.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_sanitize_catalog_pending(p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_blocked_disabled    int := 0;
  v_blocked_manual      int := 0;
  v_blocked_archived    int := 0;
  v_blocked_no_pl       int := 0;
  v_blocked_no_track    int := 0;
  v_blocked_maxed       int := 0;
  v_resched_no_oauth    int := 0;
  v_resched_breaker     int := 0;
BEGIN
  -- ====== BLOCK PERMANENTE ======
  WITH cand AS (
    SELECT cp.id
    FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    WHERE cp.status = 'pending'
      AND mp.execution_mode = 'DISABLED'::playlist_execution_mode
    LIMIT p_limit
  )
  UPDATE public.catalog_placements cp
     SET status = 'blocked',
         last_error_code = 'playlist_disabled',
         skip_reason = 'playlist_disabled',
         skipped_at = now(),
         updated_at = now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_blocked_disabled = ROW_COUNT;

  WITH cand AS (
    SELECT cp.id
    FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    WHERE cp.status = 'pending'
      AND mp.execution_mode = 'MANUAL_ONLY'::playlist_execution_mode
  )
  UPDATE public.catalog_placements cp
     SET status='blocked', last_error_code='manual_only',
         skip_reason='manual_only', skipped_at=now(), updated_at=now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_blocked_manual = ROW_COUNT;

  WITH cand AS (
    SELECT cp.id
    FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    WHERE cp.status = 'pending'
      AND mp.archived_at IS NOT NULL
  )
  UPDATE public.catalog_placements cp
     SET status='blocked', last_error_code='playlist_archived',
         skip_reason='playlist_archived', skipped_at=now(), updated_at=now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_blocked_archived = ROW_COUNT;

  WITH cand AS (
    SELECT cp.id
    FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    WHERE cp.status='pending'
      AND (mp.spotify_playlist_id IS NULL OR mp.spotify_playlist_id='')
  )
  UPDATE public.catalog_placements cp
     SET status='blocked', last_error_code='no_spotify_playlist_id',
         skip_reason='no_spotify_playlist_id', skipped_at=now(), updated_at=now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_blocked_no_pl = ROW_COUNT;

  WITH cand AS (
    SELECT cp.id
    FROM public.catalog_placements cp
    JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
    WHERE cp.status='pending'
      AND (ct.spotify_track_id IS NULL OR ct.spotify_track_id='')
  )
  UPDATE public.catalog_placements cp
     SET status='blocked', last_error_code='no_spotify_track_id',
         skip_reason='no_spotify_track_id', skipped_at=now(), updated_at=now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_blocked_no_track = ROW_COUNT;

  UPDATE public.catalog_placements
     SET status='blocked', last_error_code='max_attempts_reached',
         skip_reason='max_attempts_reached', skipped_at=now(), updated_at=now()
   WHERE status='pending' AND attempts >= max_attempts;
  GET DIAGNOSTICS v_blocked_maxed = ROW_COUNT;

  -- ====== REAGENDAMENTO TRANSITÓRIO ======

  -- Sem OAuth → reagenda +30min
  WITH cand AS (
    SELECT cp.id
    FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    WHERE cp.status='pending'
      AND cp.scheduled_for <= now()
      AND mp.owner_spotify_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.spotify_user_tokens sut
         WHERE sut.spotify_user_id = mp.owner_spotify_user_id
           AND sut.refresh_token IS NOT NULL
           AND sut.refresh_token <> ''
      )
  )
  UPDATE public.catalog_placements cp
     SET scheduled_for = now() + interval '30 minutes',
         last_error_code = 'awaiting_oauth',
         updated_at = now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_resched_no_oauth = ROW_COUNT;

  -- Circuit Breaker aberto → reagenda até blocked_until
  WITH cand AS (
    SELECT cp.id, COALESCE(scb.blocked_until, now()+interval '5 minutes') AS until_ts
    FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    JOIN LATERAL (
      SELECT sut.app_id FROM public.spotify_user_tokens sut
       WHERE sut.spotify_user_id = mp.owner_spotify_user_id
         AND sut.refresh_token IS NOT NULL AND sut.refresh_token <> ''
       ORDER BY sut.is_default DESC NULLS LAST, sut.updated_at DESC NULLS LAST
       LIMIT 1
    ) tok ON true
    JOIN public.spotify_circuit_breaker scb
      ON scb.app_id = tok.app_id::text
     AND scb.status = 'open'
     AND (scb.blocked_until IS NULL OR scb.blocked_until > now())
    WHERE cp.status='pending'
      AND cp.scheduled_for <= now()
  )
  UPDATE public.catalog_placements cp
     SET scheduled_for = cand.until_ts,
         last_error_code = 'circuit_breaker_open',
         updated_at = now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_resched_breaker = ROW_COUNT;

  RETURN jsonb_build_object(
    'blocked_disabled', v_blocked_disabled,
    'blocked_manual_only', v_blocked_manual,
    'blocked_archived', v_blocked_archived,
    'blocked_no_spotify_playlist', v_blocked_no_pl,
    'blocked_no_spotify_track', v_blocked_no_track,
    'blocked_max_attempts', v_blocked_maxed,
    'rescheduled_no_oauth', v_resched_no_oauth,
    'rescheduled_circuit_breaker', v_resched_breaker
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_sanitize_catalog_pending(integer) TO service_role;

-- =====================================================================
-- claim_next_catalog_placements: filtra elegibilidade real
-- =====================================================================
CREATE OR REPLACE FUNCTION public.claim_next_catalog_placements(_worker text, _limit integer DEFAULT 50)
 RETURNS SETOF public.catalog_placements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_max_daily   integer;
  v_done_today  integer;
  v_remaining   integer;
  v_effective   integer;
BEGIN
  -- Saneamento incremental (barato; só toca pending impossíveis)
  PERFORM public.fn_sanitize_catalog_pending(2000);

  SELECT COALESCE(catalog_max_daily_distributions, 200)
    INTO v_max_daily
  FROM public.system_flags
  ORDER BY id LIMIT 1;
  IF v_max_daily IS NULL THEN v_max_daily := 200; END IF;

  SELECT COALESCE(COUNT(*)::int, 0)
    INTO v_done_today
  FROM public.catalog_placement_execution_log l
  WHERE l.outcome IN ('active','success')
    AND (l.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  v_remaining := GREATEST(0, v_max_daily - v_done_today);
  IF v_remaining <= 0 THEN RETURN; END IF;

  v_effective := LEAST(GREATEST(1, _limit), v_remaining, 500);

  RETURN QUERY
  WITH eligible AS (
    SELECT cp.id, cp.status AS prev_status
    FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    JOIN public.catalog_tracks    ct ON ct.id = cp.catalog_track_id
    WHERE cp.status IN ('pending','retry','waiting_circuit_breaker','skipped')
      AND cp.scheduled_for <= now()
      AND cp.attempts < cp.max_attempts
      AND mp.execution_mode = 'API_READY'::playlist_execution_mode
      AND mp.archived_at IS NULL
      AND mp.spotify_playlist_id IS NOT NULL AND mp.spotify_playlist_id <> ''
      AND ct.spotify_track_id   IS NOT NULL AND ct.spotify_track_id   <> ''
      AND EXISTS (
        SELECT 1 FROM public.spotify_user_tokens sut
         WHERE sut.spotify_user_id = mp.owner_spotify_user_id
           AND sut.refresh_token IS NOT NULL AND sut.refresh_token <> ''
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.spotify_user_tokens sut
        JOIN public.spotify_circuit_breaker scb
          ON scb.app_id = sut.app_id::text
         AND scb.status = 'open'
         AND (scb.blocked_until IS NULL OR scb.blocked_until > now())
        WHERE sut.spotify_user_id = mp.owner_spotify_user_id
          AND sut.refresh_token IS NOT NULL AND sut.refresh_token <> ''
      )
    ORDER BY cp.priority ASC, cp.scheduled_for ASC, cp.created_at ASC
    LIMIT v_effective
    FOR UPDATE OF cp SKIP LOCKED
  )
  UPDATE public.catalog_placements p
  SET status           = 'processing',
      locked_at        = now(),
      locked_by        = _worker,
      lease_expires_at = now() + interval '2 minutes',
      attempts         = CASE
        WHEN eligible.prev_status IN ('waiting_circuit_breaker','skipped') THEN p.attempts
        ELSE p.attempts + 1
      END
  FROM eligible
  WHERE p.id = eligible.id
  RETURNING p.*;
END;
$function$;

-- Saneamento único da fila atual
SELECT public.fn_sanitize_catalog_pending(5000);
