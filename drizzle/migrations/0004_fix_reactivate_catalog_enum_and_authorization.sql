CREATE OR REPLACE FUNCTION public.tg_managed_playlist_reactivate_catalog()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.execution_mode = 'API_READY'
     AND OLD.execution_mode IS DISTINCT FROM 'API_READY'::public.playlist_execution_mode
     AND NEW.operational_status IS DISTINCT FROM 'do_not_operate'
     AND NEW.genre_id IS NOT NULL
     AND NEW.playlist_type = 'CATALOG'::public.playlist_type_enum
  THEN
    INSERT INTO public.catalog_placements (
      catalog_track_id, managed_playlist_id, status, origin, priority, scheduled_for
    )
    SELECT ct.id, NEW.id, 'pending', 'CATALOG', 2, now()
    FROM public.catalog_tracks ct
    WHERE ct.status = 'active'
      AND ct.catalog_distribution_authorized = true
      AND ct.genre_id = NEW.genre_id
      AND NOT EXISTS (
        SELECT 1 FROM public.catalog_placements cp
        WHERE cp.catalog_track_id = ct.id AND cp.managed_playlist_id = NEW.id AND cp.status <> 'removed'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.managed_playlist_tracks mpt
        WHERE mpt.playlist_id = NEW.id AND mpt.spotify_track_id = ct.spotify_track_id
      )
    ON CONFLICT (catalog_track_id, managed_playlist_id, copy_index) WHERE status <> 'removed' DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;