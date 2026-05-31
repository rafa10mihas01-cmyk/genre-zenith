
-- Trigger: zera next_auto_collect_at quando música entra ou é reativada com auto_collect=true
-- Garante que a música apareça IMEDIATAMENTE na fila do bot (bot-collect-queue),
-- sem esperar o ciclo natural de coleta. Cobre 3 fluxos:
--  1) Aprovação interna da campanha (INSERT de songs)
--  2) Aprovação do cliente (INSERT de songs)
--  3) Curador subindo música depois OU reativação manual (UPDATE auto_collect false->true)

CREATE OR REPLACE FUNCTION public.trg_kick_song_collect()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Só age quando música está elegível pra coletar e não está em meio a uma coleta
  IF NEW.auto_collect = true
     AND COALESCE(NEW.auto_collect_status, 'idle') IN ('idle', 'error')
  THEN
    -- Em INSERT: sempre marca pra coleta imediata
    -- Em UPDATE: só se acabou de ligar auto_collect (false->true) OU se ficou idle/error
    IF TG_OP = 'INSERT'
       OR (TG_OP = 'UPDATE' AND (
            COALESCE(OLD.auto_collect, false) = false
            OR COALESCE(OLD.auto_collect_status, 'idle') NOT IN ('idle', 'error')
       ))
    THEN
      NEW.next_auto_collect_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kick_song_collect ON public.curator_deal_songs;
CREATE TRIGGER trg_kick_song_collect
BEFORE INSERT OR UPDATE OF auto_collect, auto_collect_status
ON public.curator_deal_songs
FOR EACH ROW
EXECUTE FUNCTION public.trg_kick_song_collect();

-- Aplica IMEDIATAMENTE na música do "Toma Botadão" que está parada agora
UPDATE public.curator_deal_songs
SET next_auto_collect_at = now()
WHERE auto_collect = true
  AND auto_collect_status IN ('idle', 'error')
  AND (next_auto_collect_at IS NULL OR next_auto_collect_at > now());
