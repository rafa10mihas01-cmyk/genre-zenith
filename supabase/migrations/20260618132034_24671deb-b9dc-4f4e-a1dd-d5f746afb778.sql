-- 1) Permite o novo status na constraint
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
    'waiting_circuit_breaker'::text
  ]));

-- 2) Claim agora também volta linhas em waiting_circuit_breaker quando o
--    scheduled_for (= blocked_until do app) já passou. Preserva attempts.
CREATE OR REPLACE FUNCTION public.claim_next_catalog_placements(
  _worker text,
  _limit  integer DEFAULT 50
)
RETURNS SETOF public.catalog_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  WITH next AS (
    SELECT id, status AS prev_status
    FROM public.catalog_placements
    WHERE status IN ('pending','retry','waiting_circuit_breaker')
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
      -- Preserva attempts quando vem de waiting_circuit_breaker
      -- (a tentativa anterior nunca chegou ao Spotify).
      attempts         = CASE
        WHEN next.prev_status = 'waiting_circuit_breaker' THEN p.attempts
        ELSE p.attempts + 1
      END
  FROM next
  WHERE p.id = next.id
  RETURNING p.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_next_catalog_placements(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_catalog_placements(text, int) TO service_role;