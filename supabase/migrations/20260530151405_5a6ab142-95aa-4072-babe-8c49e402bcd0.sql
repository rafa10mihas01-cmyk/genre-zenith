
-- Backfill: extrai o ID do artista da URL pra clientes que esqueceram de preencher
UPDATE public.clients
SET spotify_artist_id = substring(spotify_artist_url FROM 'artist/([A-Za-z0-9]+)')
WHERE spotify_artist_id IS NULL
  AND spotify_artist_url ~ 'artist/[A-Za-z0-9]+';

-- Trigger pra manter sincronizado daqui pra frente
CREATE OR REPLACE FUNCTION public.sync_client_spotify_artist_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.spotify_artist_url IS NOT NULL
     AND (NEW.spotify_artist_id IS NULL OR NEW.spotify_artist_id = '')
  THEN
    NEW.spotify_artist_id := substring(NEW.spotify_artist_url FROM 'artist/([A-Za-z0-9]+)');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_client_spotify_artist_id ON public.clients;
CREATE TRIGGER trg_sync_client_spotify_artist_id
BEFORE INSERT OR UPDATE OF spotify_artist_url ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.sync_client_spotify_artist_id();
