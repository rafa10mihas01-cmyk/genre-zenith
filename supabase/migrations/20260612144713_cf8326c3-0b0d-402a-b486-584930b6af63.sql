
CREATE OR REPLACE FUNCTION public.fn_force_observational_if_ecosystem()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.spotify_playlist_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.managed_playlists mp
      WHERE mp.spotify_playlist_id = NEW.spotify_playlist_id
        AND mp.archived_at IS NULL
    ) THEN
      NEW.is_observational := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_force_observational_if_ecosystem ON public.curator_playlists;
CREATE TRIGGER trg_force_observational_if_ecosystem
BEFORE INSERT OR UPDATE OF spotify_playlist_id, is_observational
ON public.curator_playlists
FOR EACH ROW
EXECUTE FUNCTION public.fn_force_observational_if_ecosystem();

UPDATE public.curator_playlists cp
SET is_observational = true
WHERE COALESCE(cp.is_observational, false) = false
  AND cp.spotify_playlist_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.managed_playlists mp
    WHERE mp.spotify_playlist_id = cp.spotify_playlist_id
      AND mp.archived_at IS NULL
  );
