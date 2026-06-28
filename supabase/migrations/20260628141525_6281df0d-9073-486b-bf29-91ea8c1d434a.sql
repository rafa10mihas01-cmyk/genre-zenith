
-- =============================================================
-- 1. Enum de categoria de negócio
-- =============================================================
DO $$ BEGIN
  CREATE TYPE public.playlist_type_enum AS ENUM ('CAMPAIGN','CATALOG','ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- 2. Colunas novas em managed_playlists
-- =============================================================
ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS playlist_type public.playlist_type_enum,
  ADD COLUMN IF NOT EXISTS campaign_reserved_top_n smallint NOT NULL DEFAULT 5;

-- =============================================================
-- 3. Backfill da categoria
-- =============================================================
UPDATE public.managed_playlists
SET playlist_type = CASE
  WHEN archived_at IS NULL AND execution_mode IN (
    'API_READY'::playlist_execution_mode,
    'MANUAL_ONLY'::playlist_execution_mode
  ) THEN 'CAMPAIGN'::public.playlist_type_enum
  WHEN archived_at IS NOT NULL THEN 'CATALOG'::public.playlist_type_enum
  ELSE 'CATALOG'::public.playlist_type_enum
END
WHERE playlist_type IS NULL;

-- 690 que viraram CATALOG deixam de ser "arquivadas"
UPDATE public.managed_playlists
SET archived_at = NULL,
    archived_reason = NULL,
    archived_followers = NULL,
    reactivation_eligible_at = NULL
WHERE playlist_type = 'CATALOG'::public.playlist_type_enum
  AND archived_at IS NOT NULL;

-- Trava: playlist_type passa a ser obrigatório
ALTER TABLE public.managed_playlists
  ALTER COLUMN playlist_type SET DEFAULT 'CATALOG'::public.playlist_type_enum,
  ALTER COLUMN playlist_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_managed_playlists_playlist_type
  ON public.managed_playlists(playlist_type);

-- =============================================================
-- 4. compute_playlist_execution_mode — sem dependência de archived_at
-- =============================================================
CREATE OR REPLACE FUNCTION public.compute_playlist_execution_mode(
  p_archived_at timestamp with time zone,
  p_owner text
)
RETURNS playlist_execution_mode
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  -- p_archived_at mantido por compatibilidade de assinatura; não é mais usado.
  SELECT CASE
    WHEN p_owner IS NULL OR p_owner = '' THEN 'MANUAL_ONLY'::public.playlist_execution_mode
    WHEN EXISTS (
      SELECT 1 FROM public.spotify_user_tokens t
      WHERE t.spotify_user_id = p_owner AND t.refresh_token IS NOT NULL
    ) THEN 'API_READY'::public.playlist_execution_mode
    ELSE 'MANUAL_ONLY'::public.playlist_execution_mode
  END;
$$;

-- Recalcular execution_mode para CAMPAIGN + CATALOG
UPDATE public.managed_playlists mp
SET execution_mode = public.compute_playlist_execution_mode(NULL, mp.owner_spotify_user_id)
WHERE mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum;

-- ARCHIVED é sempre DISABLED operacionalmente
UPDATE public.managed_playlists
SET execution_mode = 'DISABLED'::playlist_execution_mode
WHERE playlist_type = 'ARCHIVED'::public.playlist_type_enum;

-- =============================================================
-- 5. sync_execution_mode_on_token_change — não gatear em archived_at
-- =============================================================
CREATE OR REPLACE FUNCTION public.sync_execution_mode_on_token_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_user text;
BEGIN
  v_user := COALESCE(NEW.spotify_user_id, OLD.spotify_user_id);
  IF v_user IS NULL THEN RETURN NULL; END IF;
  UPDATE public.managed_playlists mp
  SET execution_mode = public.compute_playlist_execution_mode(NULL, mp.owner_spotify_user_id)
  WHERE mp.owner_spotify_user_id = v_user
    AND mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum
    AND mp.execution_mode IS DISTINCT FROM public.compute_playlist_execution_mode(NULL, mp.owner_spotify_user_id);
  RETURN NULL;
END;
$$;

-- =============================================================
-- 6. Pipeline de catálogo — filtrar por playlist_type, não por archived_at
-- =============================================================
CREATE OR REPLACE FUNCTION public.claim_next_catalog_placements(_worker text, _limit integer DEFAULT 50)
RETURNS SETOF catalog_placements
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_max_daily   integer;
  v_done_today  integer;
  v_remaining   integer;
  v_effective   integer;
BEGIN
  PERFORM public.fn_sanitize_catalog_pending(2000);

  SELECT COALESCE(catalog_max_daily_distributions, 200)
    INTO v_max_daily
  FROM public.system_flags ORDER BY id LIMIT 1;
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
      AND mp.playlist_type IN ('CAMPAIGN'::public.playlist_type_enum, 'CATALOG'::public.playlist_type_enum)
      AND mp.execution_mode = 'API_READY'::playlist_execution_mode
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

CREATE OR REPLACE FUNCTION public.fn_decide_placement_action(p_placement_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
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

  PERFORM 1 FROM public.managed_playlist_tracks mpt
  WHERE mpt.playlist_id = v_mp.id AND mpt.spotify_track_id = v_ct.spotify_track_id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('action','SKIP','reason','already_present');
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
    RETURN jsonb_build_object('action','SKIP','reason','no_capacity_no_victim');
  END IF;

  RETURN jsonb_build_object('action','REMOVE_INSERT','remove_track_id', v_victim_track);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sanitize_catalog_pending(p_limit integer DEFAULT 2000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_blocked_archived int := 0;
  v_blocked_manual   int := 0;
  v_blocked_disabled int := 0;
  v_blocked_no_pl    int := 0;
  v_blocked_no_track int := 0;
  v_blocked_maxed    int := 0;
  v_resched_no_oauth int := 0;
  v_resched_breaker  int := 0;
BEGIN
  -- BLOCK PERMANENTE: playlist ARCHIVED
  WITH cand AS (
    SELECT cp.id FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    WHERE cp.status='pending' AND mp.playlist_type='ARCHIVED'::public.playlist_type_enum
    LIMIT p_limit
  )
  UPDATE public.catalog_placements cp
     SET status='blocked', last_error_code='playlist_archived',
         skip_reason='playlist_archived', skipped_at=now(), updated_at=now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_blocked_archived = ROW_COUNT;

  -- BLOCK PERMANENTE: execution_mode = MANUAL_ONLY
  WITH cand AS (
    SELECT cp.id FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    WHERE cp.status='pending' AND mp.execution_mode='MANUAL_ONLY'::playlist_execution_mode
  )
  UPDATE public.catalog_placements cp
     SET status='blocked', last_error_code='manual_only',
         skip_reason='manual_only', skipped_at=now(), updated_at=now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_blocked_manual = ROW_COUNT;

  -- BLOCK PERMANENTE: execution_mode = DISABLED (sem ser ARCHIVED — owner sem token p/ CAMPAIGN/CATALOG fica MANUAL_ONLY, mas guard manual)
  WITH cand AS (
    SELECT cp.id FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    WHERE cp.status='pending'
      AND mp.execution_mode='DISABLED'::playlist_execution_mode
      AND mp.playlist_type<>'ARCHIVED'::public.playlist_type_enum
  )
  UPDATE public.catalog_placements cp
     SET status='blocked', last_error_code='playlist_disabled',
         skip_reason='playlist_disabled', skipped_at=now(), updated_at=now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_blocked_disabled = ROW_COUNT;

  WITH cand AS (
    SELECT cp.id FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    WHERE cp.status='pending' AND (mp.spotify_playlist_id IS NULL OR mp.spotify_playlist_id='')
  )
  UPDATE public.catalog_placements cp
     SET status='blocked', last_error_code='no_spotify_playlist_id',
         skip_reason='no_spotify_playlist_id', skipped_at=now(), updated_at=now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_blocked_no_pl = ROW_COUNT;

  WITH cand AS (
    SELECT cp.id FROM public.catalog_placements cp
    JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
    WHERE cp.status='pending' AND (ct.spotify_track_id IS NULL OR ct.spotify_track_id='')
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

  -- Sem OAuth → reagenda +30min
  WITH cand AS (
    SELECT cp.id FROM public.catalog_placements cp
    JOIN public.managed_playlists mp ON mp.id = cp.managed_playlist_id
    WHERE cp.status='pending' AND cp.scheduled_for <= now()
      AND mp.owner_spotify_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.spotify_user_tokens sut
         WHERE sut.spotify_user_id = mp.owner_spotify_user_id
           AND sut.refresh_token IS NOT NULL AND sut.refresh_token <> ''
      )
  )
  UPDATE public.catalog_placements cp
     SET scheduled_for = now() + interval '30 minutes',
         last_error_code = 'awaiting_oauth', updated_at = now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_resched_no_oauth = ROW_COUNT;

  -- Circuit Breaker aberto → reagenda
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
    WHERE cp.status='pending' AND cp.scheduled_for <= now()
  )
  UPDATE public.catalog_placements cp
     SET scheduled_for = cand.until_ts,
         last_error_code = 'circuit_breaker_open', updated_at = now()
   FROM cand WHERE cp.id = cand.id;
  GET DIAGNOSTICS v_resched_breaker = ROW_COUNT;

  RETURN jsonb_build_object(
    'blocked_archived', v_blocked_archived,
    'blocked_manual_only', v_blocked_manual,
    'blocked_disabled', v_blocked_disabled,
    'blocked_no_spotify_playlist', v_blocked_no_pl,
    'blocked_no_spotify_track', v_blocked_no_track,
    'blocked_max_attempts', v_blocked_maxed,
    'rescheduled_no_oauth', v_resched_no_oauth,
    'rescheduled_circuit_breaker', v_resched_breaker
  );
END;
$function$;

-- =============================================================
-- 7. Views auxiliares
-- =============================================================
CREATE OR REPLACE VIEW public.v_managed_playlists_active
WITH (security_invoker = on) AS
SELECT * FROM public.managed_playlists
WHERE playlist_type <> 'ARCHIVED'::public.playlist_type_enum;

CREATE OR REPLACE VIEW public.v_managed_playlists_campaign
WITH (security_invoker = on) AS
SELECT * FROM public.managed_playlists
WHERE playlist_type = 'CAMPAIGN'::public.playlist_type_enum;

GRANT SELECT ON public.v_managed_playlists_active TO authenticated, anon;
GRANT SELECT ON public.v_managed_playlists_campaign TO authenticated, anon;
