-- Catalog placements como fila de primeira classe (aditivo, sem destrutivo)

-- 1) Colunas novas
ALTER TABLE public.catalog_placements
  ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts int NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text;

-- 2) Backfill (defaults já cuidam, mas garantimos consistência em linhas pré-existentes)
UPDATE public.catalog_placements
SET scheduled_for = COALESCE(scheduled_for, now()),
    priority      = COALESCE(priority, 2),
    attempts      = COALESCE(attempts, 0),
    max_attempts  = COALESCE(max_attempts, 6)
WHERE scheduled_for IS NULL
   OR priority IS NULL
   OR attempts IS NULL
   OR max_attempts IS NULL;

-- 3) Índices
CREATE INDEX IF NOT EXISTS idx_catalog_placements_claim
  ON public.catalog_placements (status, priority, scheduled_for)
  WHERE status IN ('pending','retry');

CREATE INDEX IF NOT EXISTS idx_catalog_placements_lease
  ON public.catalog_placements (lease_expires_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_catalog_placements_track_status
  ON public.catalog_placements (catalog_track_id, status);

-- 4) Claim atômico (SKIP LOCKED + lease + incrementa attempts)
CREATE OR REPLACE FUNCTION public.claim_next_catalog_placements(
  _worker text,
  _limit  int DEFAULT 50
)
RETURNS SETOF public.catalog_placements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH next AS (
    SELECT id
    FROM public.catalog_placements
    WHERE status IN ('pending','retry')
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
      attempts         = p.attempts + 1
  FROM next
  WHERE p.id = next.id
  RETURNING p.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_catalog_placements(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_catalog_placements(text, int) TO service_role;

-- 5) Reaper de leases expirados
CREATE OR REPLACE FUNCTION public.reap_zombie_catalog_placements()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  WITH reaped AS (
    UPDATE public.catalog_placements
    SET status           = 'pending',
        locked_at        = NULL,
        locked_by        = NULL,
        lease_expires_at = NULL,
        scheduled_for    = now()
    WHERE status = 'processing'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < now()
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_count FROM reaped;
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.reap_zombie_catalog_placements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_zombie_catalog_placements() TO service_role;