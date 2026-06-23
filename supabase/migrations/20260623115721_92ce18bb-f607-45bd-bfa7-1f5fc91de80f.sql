
-- ETAPA 1 — Robustez do Worker
-- 1) Permitir status 'skipped' e adicionar metadados de skip
ALTER TABLE public.catalog_placements
  DROP CONSTRAINT IF EXISTS catalog_placements_status_check;

ALTER TABLE public.catalog_placements
  ADD CONSTRAINT catalog_placements_status_check
  CHECK (status = ANY (ARRAY['pending','processing','retry','active','removed','failed','waiting_circuit_breaker','skipped']));

ALTER TABLE public.catalog_placements
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS skipped_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_catalog_placements_skipped_resume
  ON public.catalog_placements (scheduled_for)
  WHERE status = 'skipped';

-- 2) Atualizar claim para considerar 'skipped' como elegível ao retomar
-- (não incrementa attempts ao destravar — assim como waiting_circuit_breaker).
CREATE OR REPLACE FUNCTION public.claim_next_catalog_placements(_worker text, _limit integer DEFAULT 50)
RETURNS SETOF catalog_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH next AS (
    SELECT id, status AS prev_status
    FROM public.catalog_placements
    WHERE status IN ('pending','retry','waiting_circuit_breaker','skipped')
      AND scheduled_for <= now()
      AND attempts < max_attempts
    ORDER BY priority ASC, scheduled_for ASC, created_at ASC
    LIMIT GREATEST(1, LEAST(_limit, 500))
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
