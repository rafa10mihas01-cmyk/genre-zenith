
ALTER TABLE public.catalog_tracks
  ADD COLUMN IF NOT EXISTS spotify_artist_id text,
  ADD COLUMN IF NOT EXISTS auto_collect_interval_minutes integer NOT NULL DEFAULT 2880,
  ADD COLUMN IF NOT EXISTS last_auto_collect_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_auto_collect_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_catalog_tracks_next_auto_collect
  ON public.catalog_tracks (next_auto_collect_at)
  WHERE status = 'active';

DROP FUNCTION IF EXISTS public.claim_next_catalog_snapshots(text,integer,integer);

CREATE FUNCTION public.claim_next_catalog_snapshots(
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

CREATE OR REPLACE FUNCTION public.enqueue_catalog_snapshots_due()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enqueued int := 0;
  v_recycled int := 0;
  v_failed   int := 0;
BEGIN
  WITH zombies AS (
    UPDATE public.catalog_snapshot_queue
    SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        locked_at = NULL,
        locked_by = NULL,
        lease_expires_at = NULL,
        updated_at = now(),
        last_error = COALESCE(last_error, 'lease_expired'),
        last_error_at = now()
    WHERE status = 'processing'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < now()
    RETURNING status
  )
  SELECT
    count(*) FILTER (WHERE status = 'pending'),
    count(*) FILTER (WHERE status = 'failed')
  INTO v_recycled, v_failed
  FROM zombies;

  WITH due AS (
    SELECT ct.id, ct.spotify_track_id, ct.auto_collect_interval_minutes
    FROM public.catalog_tracks ct
    WHERE ct.status = 'active'
      AND (ct.next_auto_collect_at IS NULL OR ct.next_auto_collect_at <= now())
      AND NOT EXISTS (
        SELECT 1 FROM public.catalog_snapshot_queue q
        WHERE q.catalog_track_id = ct.id
          AND q.status IN ('pending','processing')
      )
  ),
  inserted AS (
    INSERT INTO public.catalog_snapshot_queue (
      catalog_track_id, spotify_track_id, reason, priority, status, scheduled_for
    )
    SELECT d.id, d.spotify_track_id, 'periodic', 2, 'pending', now()
    FROM due d
    RETURNING catalog_track_id
  ),
  bumped AS (
    UPDATE public.catalog_tracks ct
    SET next_auto_collect_at = now() + make_interval(mins => ct.auto_collect_interval_minutes),
        updated_at = now()
    FROM inserted i
    WHERE ct.id = i.catalog_track_id
    RETURNING ct.id
  )
  SELECT count(*) INTO v_enqueued FROM bumped;

  RETURN jsonb_build_object(
    'ok', true,
    'enqueued', v_enqueued,
    'recycled', v_recycled,
    'failed', v_failed,
    'at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_catalog_snapshots_due() TO service_role;

CREATE OR REPLACE FUNCTION public.tg_catalog_track_enqueue_baseline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    INSERT INTO public.catalog_snapshot_queue (
      catalog_track_id, spotify_track_id, reason, priority, status, scheduled_for
    ) VALUES (
      NEW.id, NEW.spotify_track_id, 'baseline', 1, 'pending', now()
    )
    ON CONFLICT DO NOTHING;
    NEW.next_auto_collect_at := now() + make_interval(mins => COALESCE(NEW.auto_collect_interval_minutes, 2880));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS catalog_track_baseline_enqueue ON public.catalog_tracks;
CREATE TRIGGER catalog_track_baseline_enqueue
  BEFORE INSERT ON public.catalog_tracks
  FOR EACH ROW EXECUTE FUNCTION public.tg_catalog_track_enqueue_baseline();
