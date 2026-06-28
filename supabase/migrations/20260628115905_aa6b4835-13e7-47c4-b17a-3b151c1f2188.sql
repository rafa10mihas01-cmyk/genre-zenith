
-- 1) Novo limite independente para o Occupancy
ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS occupancy_max_daily_operations integer NOT NULL DEFAULT 600;

-- 2) CATALOG — claim usa SOMENTE catalog_placement_execution_log
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

  IF v_max_daily IS NULL THEN v_max_daily := 200; END IF;

  -- Conta APENAS distribuições reais (catalog). Occupancy tem cota própria.
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
  WITH next AS (
    SELECT id, status AS prev_status
    FROM public.catalog_placements
    WHERE status IN ('pending','retry','waiting_circuit_breaker','skipped')
      AND status <> 'blocked'
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

-- 3) OCCUPANCY — claim usa SOMENTE occupancy_plan_ops contra occupancy_max_daily_operations
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
         COALESCE(occupancy_max_daily_operations, 600)
    INTO v_flag, v_max_daily
  FROM public.system_flags
  ORDER BY id
  LIMIT 1;

  IF lower(COALESCE(v_flag,'shadow')) NOT IN ('dual_write','primary') THEN
    RETURN;
  END IF;

  IF v_max_daily IS NULL THEN v_max_daily := 600; END IF;

  -- Conta APENAS operações do próprio Occupancy. Catalog tem cota separada.
  SELECT COALESCE(COUNT(*)::int, 0)
    INTO v_done_today
  FROM public.occupancy_plan_ops o
  JOIN public.occupancy_plans p ON p.id = o.plan_id
  WHERE o.op_status = 'done'
    AND p.mode IN ('DUAL_WRITE','PRIMARY')
    AND (o.executed_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  v_remaining := GREATEST(0, v_max_daily - v_done_today);
  IF v_remaining <= 0 THEN RETURN; END IF;

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
    IF v_claimed_ops >= v_remaining THEN EXIT; END IF;
    IF v_claimed_ops + COALESCE(r.ops_count,0) > v_remaining THEN CONTINUE; END IF;

    v_lock_key := ('x' || substr(md5(r.managed_playlist_id::text),1,16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN CONTINUE; END IF;

    UPDATE public.occupancy_plans
       SET executor_status = 'processing',
           locked_at = now()
     WHERE id = r.id;

    plan_id := r.id;
    managed_playlist_id := r.managed_playlist_id;
    mode := r.mode;
    ops_count := r.ops_count;
    v_claimed_ops := v_claimed_ops + COALESCE(r.ops_count,0);
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$function$;
