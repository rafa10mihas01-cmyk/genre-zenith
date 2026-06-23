
CREATE OR REPLACE FUNCTION public.tg_enqueue_catalog_post_placement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spotify_id text;
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT spotify_track_id INTO v_spotify_id
    FROM public.catalog_tracks
    WHERE id = NEW.catalog_track_id;

    IF v_spotify_id IS NOT NULL THEN
      INSERT INTO public.catalog_snapshot_queue (
        catalog_track_id, spotify_track_id, reason, priority, scheduled_for
      )
      VALUES (NEW.catalog_track_id, v_spotify_id, 'post_placement', 2, now())
      ON CONFLICT (catalog_track_id, reason)
        WHERE status IN ('pending','retry','processing') DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Libera os jobs já enfileirados com scheduled_for futuro injetado pelo bug
UPDATE public.catalog_snapshot_queue
SET scheduled_for = now(), updated_at = now()
WHERE status = 'pending'
  AND reason = 'post_placement'
  AND scheduled_for > now();
