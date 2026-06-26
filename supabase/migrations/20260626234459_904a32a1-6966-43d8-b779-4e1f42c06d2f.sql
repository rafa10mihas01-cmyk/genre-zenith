-- 1) Permitir status 'blocked' na tabela
ALTER TABLE public.catalog_placements
  DROP CONSTRAINT IF EXISTS catalog_placements_status_check;

ALTER TABLE public.catalog_placements
  ADD CONSTRAINT catalog_placements_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'processing'::text,
    'retry'::text,
    'active'::text,
    'removed'::text,
    'failed'::text,
    'waiting_circuit_breaker'::text,
    'skipped'::text,
    'blocked'::text
  ]));

-- 2) Reforço explícito: a fila NUNCA reclama 'blocked'
-- (o WHERE já filtra por status IN (...) sem 'blocked', mas deixamos
--  explícito para auditoria futura).
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
      AND status <> 'blocked'  -- guarda explícita: bloqueio definitivo
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

-- 3) Índice de apoio: distinguir backlog real de bloqueados em dashboards
CREATE INDEX IF NOT EXISTS catalog_placements_blocked_idx
  ON public.catalog_placements (last_error_code)
  WHERE status = 'blocked';