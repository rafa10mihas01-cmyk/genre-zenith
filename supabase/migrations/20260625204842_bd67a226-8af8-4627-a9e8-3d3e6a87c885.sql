CREATE OR REPLACE FUNCTION public.claim_next_catalog_snapshots(
  p_worker_id text,
  p_limit int DEFAULT 5,
  p_lease_seconds int DEFAULT 600
)
RETURNS TABLE (
  id uuid,
  catalog_track_id uuid,
  spotify_track_id text,
  reason text,
  priority smallint,
  attempts int,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Antes de entregar novos trabalhos, recupera jobs que ficaram presos
  -- em processing com lease vencido. Sem isso, um job pode ficar invisível
  -- para sempre se o VPS não confirmar conclusão.
  UPDATE public.catalog_snapshot_queue q
  SET status = CASE WHEN q.attempts >= q.max_attempts THEN 'failed' ELSE 'pending' END,
      locked_at = NULL,
      locked_by = NULL,
      lease_expires_at = NULL,
      last_error = COALESCE(q.last_error, 'lease_expired'),
      last_error_at = COALESCE(q.last_error_at, now()),
      updated_at = now()
  WHERE q.status = 'processing'
    AND q.lease_expires_at IS NOT NULL
    AND q.lease_expires_at < now();

  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM public.catalog_snapshot_queue q
    WHERE q.status = 'pending'
      AND q.scheduled_for <= now()
      AND q.attempts < q.max_attempts
    ORDER BY q.priority ASC, q.scheduled_for ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.catalog_snapshot_queue q
  SET status = 'processing',
      locked_at = now(),
      locked_by = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempts = q.attempts + 1,
      updated_at = now()
  FROM picked
  WHERE q.id = picked.id
  RETURNING q.id, q.catalog_track_id, q.spotify_track_id, q.reason,
            q.priority, q.attempts, q.lease_expires_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_next_catalog_snapshots(text,int,int) TO service_role;

UPDATE public.catalog_snapshot_queue
SET status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    lease_expires_at = NULL,
    last_error = 'retry_after_stale_processing_lock',
    last_error_at = now(),
    scheduled_for = now(),
    updated_at = now()
WHERE id = '6ea95271-03e1-4a25-9e87-0810450b970f'
  AND status = 'processing';