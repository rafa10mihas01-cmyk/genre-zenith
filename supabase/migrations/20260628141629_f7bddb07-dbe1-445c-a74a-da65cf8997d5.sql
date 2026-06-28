
CREATE OR REPLACE FUNCTION public.sync_archived_at_with_playlist_type()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.playlist_type = 'ARCHIVED'::public.playlist_type_enum THEN
    IF NEW.archived_at IS NULL THEN
      NEW.archived_at := now();
    END IF;
  ELSE
    NEW.archived_at := NULL;
    NEW.archived_reason := NULL;
    NEW.archived_followers := NULL;
    NEW.reactivation_eligible_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_archived_at_with_playlist_type ON public.managed_playlists;
CREATE TRIGGER trg_sync_archived_at_with_playlist_type
BEFORE INSERT OR UPDATE OF playlist_type, archived_at
ON public.managed_playlists
FOR EACH ROW EXECUTE FUNCTION public.sync_archived_at_with_playlist_type();
