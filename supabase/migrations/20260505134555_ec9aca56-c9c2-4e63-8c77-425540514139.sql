-- Permite match_status='algorithmic' (Spotify Radio/Mix/Daylist etc.)
-- São linhas internas pra alertas, não mostradas em curadoria.
CREATE OR REPLACE FUNCTION public.validate_curator_playlist_match_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.match_status NOT IN ('curator','baseline','editorial','suspicious','organic','algorithmic') THEN
    RAISE EXCEPTION 'match_status inválido: %. Use curator, baseline, editorial, suspicious, organic ou algorithmic.', NEW.match_status;
  END IF;
  RETURN NEW;
END;
$$;