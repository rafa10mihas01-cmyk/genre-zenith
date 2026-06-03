
-- ============================================================
-- A) execution_mode em managed_playlists
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='playlist_execution_mode') THEN
    CREATE TYPE public.playlist_execution_mode AS ENUM ('API_READY','MANUAL_ONLY','DISABLED');
  END IF;
END $$;

ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS execution_mode public.playlist_execution_mode;

-- ============================================================
-- B) Função pura que decide o modo
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_playlist_execution_mode(
  p_archived_at timestamptz,
  p_owner text
) RETURNS public.playlist_execution_mode
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN p_archived_at IS NOT NULL THEN 'DISABLED'::public.playlist_execution_mode
    WHEN p_owner IS NULL OR p_owner = '' THEN 'MANUAL_ONLY'::public.playlist_execution_mode
    WHEN EXISTS (
      SELECT 1 FROM public.spotify_user_tokens t
      WHERE t.spotify_user_id = p_owner AND t.refresh_token IS NOT NULL
    ) THEN 'API_READY'::public.playlist_execution_mode
    ELSE 'MANUAL_ONLY'::public.playlist_execution_mode
  END;
$$;

-- Trigger BEFORE em managed_playlists
CREATE OR REPLACE FUNCTION public.set_managed_playlist_execution_mode()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.execution_mode := public.compute_playlist_execution_mode(NEW.archived_at, NEW.owner_spotify_user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_mp_execution_mode ON public.managed_playlists;
CREATE TRIGGER trg_set_mp_execution_mode
BEFORE INSERT OR UPDATE OF archived_at, owner_spotify_user_id
ON public.managed_playlists
FOR EACH ROW EXECUTE FUNCTION public.set_managed_playlist_execution_mode();

-- ============================================================
-- D) Auto-transição quando token aparece/desaparece
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_execution_mode_on_token_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user text;
BEGIN
  v_user := COALESCE(NEW.spotify_user_id, OLD.spotify_user_id);
  IF v_user IS NULL THEN RETURN NULL; END IF;
  UPDATE public.managed_playlists mp
  SET execution_mode = public.compute_playlist_execution_mode(mp.archived_at, mp.owner_spotify_user_id)
  WHERE mp.owner_spotify_user_id = v_user
    AND mp.archived_at IS NULL
    AND mp.execution_mode IS DISTINCT FROM public.compute_playlist_execution_mode(mp.archived_at, mp.owner_spotify_user_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_mode_token_upsert ON public.spotify_user_tokens;
CREATE TRIGGER trg_sync_mode_token_upsert
AFTER INSERT OR UPDATE OF refresh_token, spotify_user_id
ON public.spotify_user_tokens
FOR EACH ROW EXECUTE FUNCTION public.sync_execution_mode_on_token_change();

DROP TRIGGER IF EXISTS trg_sync_mode_token_del ON public.spotify_user_tokens;
CREATE TRIGGER trg_sync_mode_token_del
AFTER DELETE ON public.spotify_user_tokens
FOR EACH ROW EXECUTE FUNCTION public.sync_execution_mode_on_token_change();

-- ============================================================
-- Backfill em todas as 810 playlists existentes
-- ============================================================
UPDATE public.managed_playlists
SET execution_mode = public.compute_playlist_execution_mode(archived_at, owner_spotify_user_id);

ALTER TABLE public.managed_playlists
  ALTER COLUMN execution_mode SET NOT NULL,
  ALTER COLUMN execution_mode SET DEFAULT 'MANUAL_ONLY';

CREATE INDEX IF NOT EXISTS idx_managed_playlists_execution_mode
  ON public.managed_playlists(execution_mode);

-- ============================================================
-- E) Painel manual: posição planejada / executada
--    (operador = completed_by, observação = observacao, data = completed_at já existem)
-- ============================================================
ALTER TABLE public.manual_distribution_queue
  ADD COLUMN IF NOT EXISTS planned_position int,
  ADD COLUMN IF NOT EXISTS executed_position int;

UPDATE public.manual_distribution_queue
SET planned_position = position
WHERE planned_position IS NULL AND position IS NOT NULL;
