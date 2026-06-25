
ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS catalog_max_daily_distributions integer NOT NULL DEFAULT 200;

COMMENT ON COLUMN public.system_flags.catalog_max_daily_distributions IS
  'Limite global de distribuições de catálogo executadas com sucesso por dia (BRT). O Executor respeita sempre o menor valor entre a meta da campanha e este limite.';

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
  -- 1) Lê limite global (singleton system_flags)
  SELECT COALESCE(catalog_max_daily_distributions, 200)
    INTO v_max_daily
  FROM public.system_flags
  ORDER BY id
  LIMIT 1;

  IF v_max_daily IS NULL THEN
    v_max_daily := 200;
  END IF;

  -- 2) Conta execuções com sucesso já realizadas hoje (fuso BRT)
  SELECT COUNT(*)::int
    INTO v_done_today
  FROM public.catalog_placement_execution_log
  WHERE outcome = 'success'
    AND (executed_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  v_remaining := GREATEST(0, v_max_daily - COALESCE(v_done_today, 0));

  -- 3) Se já atingiu o teto diário, não devolve nada
  IF v_remaining <= 0 THEN
    RETURN;
  END IF;

  -- 4) Limite efetivo = min(_limit pedido, remanescente, 500)
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
