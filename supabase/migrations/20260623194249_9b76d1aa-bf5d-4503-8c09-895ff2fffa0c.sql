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

  WITH snapshot_clock AS (
    SELECT
      ct.id,
      ct.spotify_track_id,
      GREATEST(COALESCE(ct.auto_collect_interval_minutes, 2880), 5) AS interval_minutes,
      max(ss.captured_at) AS last_snapshot_at
    FROM public.catalog_tracks ct
    LEFT JOIN public.song_snapshots ss
      ON ss.catalog_track_id = ct.id
    WHERE ct.status = 'active'
      AND ct.spotify_track_id IS NOT NULL
      AND btrim(ct.spotify_track_id) <> ''
    GROUP BY ct.id, ct.spotify_track_id, ct.auto_collect_interval_minutes
  ),
  due AS (
    SELECT sc.id, sc.spotify_track_id, sc.interval_minutes, sc.last_snapshot_at
    FROM snapshot_clock sc
    JOIN public.catalog_tracks ct ON ct.id = sc.id
    WHERE (
        ct.next_auto_collect_at IS NULL
        OR ct.next_auto_collect_at <= now()
        OR (
          sc.last_snapshot_at IS NOT NULL
          AND sc.last_snapshot_at + make_interval(mins => sc.interval_minutes) <= now()
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.catalog_snapshot_queue q
        WHERE q.catalog_track_id = sc.id
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
    SET next_auto_collect_at = now() + make_interval(mins => GREATEST(COALESCE(ct.auto_collect_interval_minutes, 2880), 5)),
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

CREATE OR REPLACE FUNCTION public.tg_catalog_snapshot_queue_done_bump_track()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_captured_at timestamptz;
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.completed_snapshot_id IS NOT NULL THEN
      SELECT captured_at INTO v_captured_at
      FROM public.song_snapshots
      WHERE id = NEW.completed_snapshot_id;
    END IF;

    UPDATE public.catalog_tracks ct
    SET last_auto_collect_at = COALESCE(v_captured_at, now()),
        next_auto_collect_at = COALESCE(v_captured_at, now()) + make_interval(mins => GREATEST(COALESCE(ct.auto_collect_interval_minutes, 2880), 5)),
        updated_at = now()
    WHERE ct.id = NEW.catalog_track_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_catalog_snapshot_queue_done_bump_track ON public.catalog_snapshot_queue;
CREATE TRIGGER trg_catalog_snapshot_queue_done_bump_track
  AFTER UPDATE OF status, completed_snapshot_id ON public.catalog_snapshot_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_catalog_snapshot_queue_done_bump_track();

WITH latest AS (
  SELECT
    ct.id,
    max(ss.captured_at) AS last_snapshot_at
  FROM public.catalog_tracks ct
  LEFT JOIN public.song_snapshots ss
    ON ss.catalog_track_id = ct.id
  WHERE ct.status = 'active'
  GROUP BY ct.id
)
UPDATE public.catalog_tracks ct
SET last_auto_collect_at = latest.last_snapshot_at,
    next_auto_collect_at = CASE
      WHEN latest.last_snapshot_at IS NOT NULL THEN
        latest.last_snapshot_at + make_interval(mins => GREATEST(COALESCE(ct.auto_collect_interval_minutes, 2880), 5))
      WHEN ct.next_auto_collect_at IS NULL THEN
        now()
      ELSE ct.next_auto_collect_at
    END,
    updated_at = now()
FROM latest
WHERE ct.id = latest.id;