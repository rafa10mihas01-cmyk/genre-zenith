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
  SELECT COALESCE(catalog_max_daily_distributions, 200)
    INTO v_max_daily
  FROM public.system_flags
  ORDER BY id
  LIMIT 1;

  IF v_max_daily IS NULL THEN
    v_max_daily := 200;
  END IF;

  SELECT (
    COALESCE((
      SELECT COUNT(*)::int
      FROM public.catalog_placement_execution_log l
      WHERE l.outcome IN ('active','success')
        AND (l.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
            = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ), 0)
    +
    COALESCE((
      SELECT COUNT(*)::int
      FROM public.occupancy_plan_ops o
      JOIN public.occupancy_plans p ON p.id = o.plan_id
      WHERE o.op_status = 'done'
        AND p.mode IN ('DUAL_WRITE','PRIMARY')
        AND (o.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
            = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ), 0)
  ) INTO v_done_today;

  v_remaining := GREATEST(0, v_max_daily - COALESCE(v_done_today, 0));

  IF v_remaining <= 0 THEN
    RETURN;
  END IF;

  v_effective := LEAST(GREATEST(1, _limit), v_remaining, 500);

  RETURN QUERY
  WITH next AS (
    SELECT id, status AS prev_status
    FROM public.catalog_placements
    WHERE status IN ('pending','retry','waiting_circuit_breaker','skipped')
      AND scheduled_for <= now()
      AND attempts < max_attempts
    ORDER BY priority ASC, scheduled_for ASC, created_at ASC
    LIMIT v_effective
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.catalog_placements p
  SET status           = 'processing',
      locked_at        = now(),
      locked_by        = _worker,
      lease_expires_at = now() + interval '2 minutes',
      attempts         = CASE
        WHEN next.prev_status IN ('waiting_circuit_breaker','skipped') THEN p.attempts
        ELSE p.attempts + 1
      END
  FROM next
  WHERE p.id = next.id
  RETURNING p.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_occupancy_claim_executable_plans(p_limit integer DEFAULT 10)
 RETURNS TABLE(plan_id uuid, managed_playlist_id uuid, mode text, ops_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_lock_key bigint;
  v_flag text;
  v_max_daily integer;
  v_done_today integer;
  v_remaining integer;
  v_claimed_ops integer := 0;
BEGIN
  SELECT occupancy_engine_mode,
         COALESCE(catalog_max_daily_distributions, 200)
    INTO v_flag, v_max_daily
  FROM public.system_flags
  ORDER BY id
  LIMIT 1;

  IF lower(COALESCE(v_flag,'shadow')) NOT IN ('dual_write','primary') THEN
    RETURN;
  END IF;

  IF v_max_daily IS NULL THEN
    v_max_daily := 200;
  END IF;

  SELECT (
    COALESCE((
      SELECT COUNT(*)::int
      FROM public.catalog_placement_execution_log l
      WHERE l.outcome IN ('active','success')
        AND (l.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
            = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ), 0)
    +
    COALESCE((
      SELECT COUNT(*)::int
      FROM public.occupancy_plan_ops o
      JOIN public.occupancy_plans p ON p.id = o.plan_id
      WHERE o.op_status = 'done'
        AND p.mode IN ('DUAL_WRITE','PRIMARY')
        AND (o.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
            = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ), 0)
  ) INTO v_done_today;

  v_remaining := GREATEST(0, v_max_daily - COALESCE(v_done_today, 0));

  IF v_remaining <= 0 THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT p.id, p.managed_playlist_id, p.mode, p.ops_count
      FROM public.occupancy_plans p
     WHERE p.status = 'ready'
       AND p.mode IN ('DUAL_WRITE','PRIMARY')
       AND p.executor_status = 'pending'
       AND COALESCE(p.ops_count,0) > 0
     ORDER BY p.finalized_at NULLS LAST
     LIMIT GREATEST(1, p_limit * 5)
     FOR UPDATE SKIP LOCKED
  LOOP
    IF v_claimed_ops >= v_remaining THEN
      EXIT;
    END IF;

    IF v_claimed_ops + COALESCE(r.ops_count,0) > v_remaining THEN
      CONTINUE;
    END IF;

    v_lock_key := ('x' || substr(md5(r.managed_playlist_id::text),1,16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
      CONTINUE;
    END IF;

    UPDATE public.occupancy_plans
       SET executor_status = 'running',
           executor_attempts = executor_attempts + 1
     WHERE id = r.id;

    v_claimed_ops := v_claimed_ops + COALESCE(r.ops_count,0);
    plan_id := r.id;
    managed_playlist_id := r.managed_playlist_id;
    mode := r.mode;
    ops_count := r.ops_count;
    RETURN NEXT;

    IF v_claimed_ops >= v_remaining THEN
      EXIT;
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.catalog_daily_distribution_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit    integer;
  v_done     integer;
  v_by_owner jsonb;
BEGIN
  SELECT COALESCE(catalog_max_daily_distributions, 200)
    INTO v_limit
  FROM public.system_flags
  ORDER BY id
  LIMIT 1;

  IF v_limit IS NULL THEN v_limit := 200; END IF;

  SELECT COUNT(*)::int
    INTO v_done
  FROM (
    SELECT l.managed_playlist_id, l.executed_at
    FROM public.catalog_placement_execution_log l
    WHERE l.outcome IN ('active','success')
      AND (l.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
          = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    UNION ALL
    SELECT p.managed_playlist_id, o.executed_at
    FROM public.occupancy_plan_ops o
    JOIN public.occupancy_plans p ON p.id = o.plan_id
    WHERE o.op_status = 'done'
      AND p.mode IN ('DUAL_WRITE','PRIMARY')
      AND (o.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
          = (now() AT TIME ZONE 'America/Sao_Paulo')::date
  ) used_ops;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.count DESC), '[]'::jsonb)
    INTO v_by_owner
  FROM (
    SELECT COALESCE(a.display_name, a.email, mp.owner_spotify_user_id, 'sem conta') AS owner,
           COUNT(*)::int AS count
    FROM (
      SELECT l.managed_playlist_id, l.executed_at
      FROM public.catalog_placement_execution_log l
      WHERE l.outcome IN ('active','success')
        AND (l.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
            = (now() AT TIME ZONE 'America/Sao_Paulo')::date
      UNION ALL
      SELECT p.managed_playlist_id, o.executed_at
      FROM public.occupancy_plan_ops o
      JOIN public.occupancy_plans p ON p.id = o.plan_id
      WHERE o.op_status = 'done'
        AND p.mode IN ('DUAL_WRITE','PRIMARY')
        AND (o.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
            = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ) l
    JOIN public.managed_playlists mp ON mp.id = l.managed_playlist_id
    LEFT JOIN public.accounts a ON a.id = mp.account_id
    GROUP BY 1
    ORDER BY 2 DESC
  ) r;

  RETURN jsonb_build_object(
    'limit',          v_limit,
    'executed_today', COALESCE(v_done, 0),
    'remaining',      GREATEST(0, v_limit - COALESCE(v_done, 0)),
    'by_owner',       v_by_owner
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_next_catalog_placements(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_occupancy_claim_executable_plans(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.catalog_daily_distribution_stats() TO authenticated, service_role;