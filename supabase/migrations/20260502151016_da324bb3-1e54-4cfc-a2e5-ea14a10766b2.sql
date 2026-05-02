-- 1) Remove o log fantasma (deal Igor, song_id NULL, criado por engano com plays do Botadão)
DELETE FROM public.curator_deal_logs
WHERE id = '1977887d-7d9d-4aa5-a8f4-628c9488b4db';

-- 2) Trigger: bloqueia inserts sem song_id quando o deal tem 2+ músicas
CREATE OR REPLACE FUNCTION public.enforce_song_id_on_multi_song_deals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_song_count int;
BEGIN
  IF NEW.song_id IS NULL THEN
    SELECT COUNT(*) INTO v_song_count
      FROM public.curator_deal_songs
      WHERE deal_id = NEW.deal_id;

    IF v_song_count >= 2 THEN
      RAISE EXCEPTION 'song_id é obrigatório em deals com múltiplas músicas (deal_id=%, músicas=%)',
        NEW.deal_id, v_song_count
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_song_id_logs ON public.curator_deal_logs;
CREATE TRIGGER trg_enforce_song_id_logs
  BEFORE INSERT OR UPDATE ON public.curator_deal_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_song_id_on_multi_song_deals();

DROP TRIGGER IF EXISTS trg_enforce_song_id_playlists ON public.curator_playlists;
CREATE TRIGGER trg_enforce_song_id_playlists
  BEFORE INSERT OR UPDATE ON public.curator_playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_song_id_on_multi_song_deals();