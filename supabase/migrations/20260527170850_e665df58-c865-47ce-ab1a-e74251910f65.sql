
-- 1) Tabela da fila
CREATE TABLE IF NOT EXISTS public.playlist_operation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  operation_type text NOT NULL CHECK (operation_type IN ('AUTO_SYNC','MANUAL_EDITOR','DIAGNOSE_ENGINE','MAINTENANCE','BACKFILL')),
  priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 3),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by text,
  completed_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Grants: fila é interna ao backend, nada de anon/authenticated
GRANT ALL ON public.playlist_operation_queue TO service_role;

ALTER TABLE public.playlist_operation_queue ENABLE ROW LEVEL SECURITY;

-- Sem policies pra anon/authenticated — só service_role acessa (bypass RLS).

-- Índices
CREATE INDEX IF NOT EXISTS playlist_operation_queue_pickup_idx
  ON public.playlist_operation_queue (priority ASC, scheduled_for ASC, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS playlist_operation_queue_playlist_status_idx
  ON public.playlist_operation_queue (playlist_id, status);

CREATE INDEX IF NOT EXISTS playlist_operation_queue_dedupe_idx
  ON public.playlist_operation_queue (playlist_id, operation_type)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS playlist_operation_queue_zombie_idx
  ON public.playlist_operation_queue (claimed_at)
  WHERE status = 'processing';

-- 2) Claim atômico: pega o próximo job, garante 1-por-playlist em paralelo
CREATE OR REPLACE FUNCTION public.claim_next_playlist_job(_claimed_by text)
RETURNS SETOF public.playlist_operation_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH next AS (
    SELECT q.id
    FROM public.playlist_operation_queue q
    WHERE q.status = 'pending'
      AND q.scheduled_for <= now()
      AND NOT EXISTS (
        SELECT 1 FROM public.playlist_operation_queue p
        WHERE p.playlist_id = q.playlist_id
          AND p.status = 'processing'
      )
    ORDER BY q.priority ASC, q.scheduled_for ASC, q.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.playlist_operation_queue q
  SET status = 'processing',
      claimed_at = now(),
      claimed_by = _claimed_by,
      attempts = q.attempts + 1
  FROM next
  WHERE q.id = next.id
  RETURNING q.*;
END
$$;

REVOKE ALL ON FUNCTION public.claim_next_playlist_job(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_playlist_job(text) TO service_role;

-- 3) Reaper: jobs travados em 'processing' há > 5min voltam pra 'pending'
CREATE OR REPLACE FUNCTION public.reap_zombie_playlist_jobs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  WITH reaped AS (
    UPDATE public.playlist_operation_queue
    SET status = 'pending',
        claimed_at = NULL,
        claimed_by = NULL,
        scheduled_for = now(),
        error = COALESCE(error,'') || ' [reaped zombie]'
    WHERE status = 'processing'
      AND claimed_at < now() - interval '5 minutes'
    RETURNING id
  )
  SELECT count(*)::int INTO n FROM reaped;
  RETURN COALESCE(n, 0);
END
$$;

REVOKE ALL ON FUNCTION public.reap_zombie_playlist_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_zombie_playlist_jobs() TO service_role;
