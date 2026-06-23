CREATE OR REPLACE FUNCTION public.tg_catalog_snapshot_queue_done_bump_track()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_captured_at timestamptz;
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.reason = 'manual_test' THEN
      RETURN NEW;
    END IF;

    IF NEW.completed_snapshot_id IS NOT NULL THEN
      SELECT captured_at INTO v_captured_at
      FROM public.song_snapshots
      WHERE id = NEW.completed_snapshot_id;
    END IF;

    UPDATE public.catalog_tracks ct
    SET last_auto_collect_at = COALESCE(v_captured_at, now()),
        next_auto_collect_at = COALESCE(v_captured_at, now())
                               + make_interval(mins => GREATEST(COALESCE(ct.auto_collect_interval_minutes, 2880), 5)),
        updated_at = now()
    WHERE ct.id = NEW.catalog_track_id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_enqueue_catalog_test_snapshot(p_catalog_track_id uuid)
RETURNS TABLE (
  queue_id uuid,
  catalog_track_id uuid,
  spotify_track_id text,
  reason text,
  status text,
  scheduled_for timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_spotify_track_id text;
  v_existing_id uuid;
  v_new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_catalog_track_id IS NULL THEN
    RAISE EXCEPTION 'p_catalog_track_id is required';
  END IF;

  SELECT ct.spotify_track_id
    INTO v_spotify_track_id
  FROM public.catalog_tracks ct
  WHERE ct.id = p_catalog_track_id;

  IF v_spotify_track_id IS NULL THEN
    RAISE EXCEPTION 'catalog_track % not found or missing spotify_track_id', p_catalog_track_id;
  END IF;

  SELECT q.id
    INTO v_existing_id
  FROM public.catalog_snapshot_queue q
  WHERE q.catalog_track_id = p_catalog_track_id
    AND q.reason = 'manual_test'
    AND q.status IN ('pending', 'retry', 'processing')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY
    SELECT q.id, q.catalog_track_id, q.spotify_track_id, q.reason, q.status, q.scheduled_for
    FROM public.catalog_snapshot_queue q
    WHERE q.id = v_existing_id;
    RETURN;
  END IF;

  INSERT INTO public.catalog_snapshot_queue (
    catalog_track_id,
    spotify_track_id,
    reason,
    priority,
    status,
    scheduled_for
  ) VALUES (
    p_catalog_track_id,
    v_spotify_track_id,
    'manual_test',
    1,
    'pending',
    now()
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY
  SELECT q.id, q.catalog_track_id, q.spotify_track_id, q.reason, q.status, q.scheduled_for
  FROM public.catalog_snapshot_queue q
  WHERE q.id = v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_enqueue_catalog_test_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_enqueue_catalog_test_snapshot(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_enqueue_catalog_test_snapshot(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_enqueue_catalog_test_snapshot(uuid) IS
  'Admin-only. Enfileira 1 job spotify.catalog.collect (reason=manual_test) para validar o scraper sem alterar last_auto_collect_at/next_auto_collect_at. O trigger tg_catalog_snapshot_queue_done_bump_track ignora jobs com reason=manual_test.';