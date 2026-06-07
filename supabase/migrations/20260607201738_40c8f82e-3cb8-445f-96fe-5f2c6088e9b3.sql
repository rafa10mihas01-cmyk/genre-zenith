
-- 1) Coluna operational_status
ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS operational_status text;

COMMENT ON COLUMN public.managed_playlists.operational_status IS
  'Estado operacional não-fatal: oauth_disconnected, spotify_auth_error, collection_failed, snapshot_stale. Não arquiva a playlist.';

CREATE INDEX IF NOT EXISTS idx_managed_playlists_operational_status
  ON public.managed_playlists(operational_status)
  WHERE operational_status IS NOT NULL;

-- 2) Guard: bloqueia auto-arquivamento de playlists relevantes (followers >= 100)
--    por motivos operacionais. Converte a tentativa em operational_status.
CREATE OR REPLACE FUNCTION public.guard_managed_playlist_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := NEW.archived_reason;
  v_operational text[] := ARRAY[
    'owner_oauth_disconnected',
    'spotify_401',
    'spotify_401_persistent',
    'spotify_403',
    'token_expired',
    'refresh_failed',
    'snapshot_failed',
    'sync_failed',
    'app_blocked',
    'auth_breaker',
    'collection_failed'
  ];
  v_transition boolean;
BEGIN
  v_transition := NEW.archived_at IS NOT NULL
                  AND (TG_OP = 'INSERT' OR OLD.archived_at IS NULL);

  IF v_transition
     AND COALESCE(NEW.followers, 0) >= 100
     AND v_reason = ANY(v_operational)
  THEN
    -- Não arquiva. Marca apenas o estado operacional.
    NEW.archived_at := NULL;
    NEW.archived_reason := NULL;
    NEW.archived_followers := NULL;
    NEW.operational_status := CASE v_reason
      WHEN 'owner_oauth_disconnected' THEN 'oauth_disconnected'
      WHEN 'spotify_401'              THEN 'spotify_auth_error'
      WHEN 'spotify_401_persistent'   THEN 'spotify_auth_error'
      WHEN 'spotify_403'              THEN 'spotify_auth_error'
      WHEN 'token_expired'            THEN 'spotify_auth_error'
      WHEN 'refresh_failed'           THEN 'spotify_auth_error'
      WHEN 'snapshot_failed'          THEN 'snapshot_stale'
      WHEN 'sync_failed'              THEN 'collection_failed'
      WHEN 'app_blocked'              THEN 'collection_failed'
      WHEN 'auth_breaker'             THEN 'collection_failed'
      ELSE                                 'collection_failed'
    END;
    RAISE WARNING
      'BLOCKED auto-archive playlist=% followers=% reason=% -> operational_status=%',
      NEW.id, NEW.followers, v_reason, NEW.operational_status;
  ELSIF v_transition
        AND COALESCE(NEW.followers, 0) >= 100
        AND v_reason IS NULL
  THEN
    -- Auto-archive SEM motivo explícito + playlist relevante = bloquear.
    -- Forçamos motivo explícito ('manual', 'spotify_404', 'auto_onboarding_low_followers').
    NEW.archived_at := NULL;
    NEW.operational_status := 'collection_failed';
    RAISE WARNING
      'BLOCKED auto-archive playlist=% followers=% reason=NULL (motivo obrigatório)',
      NEW.id, NEW.followers;
  END IF;

  -- Se desarquivou (archived_at -> NULL), zera operational_status só quando o
  -- desarquivamento é manual (reason=NULL setado pelo restore).
  IF TG_OP = 'UPDATE'
     AND OLD.archived_at IS NOT NULL
     AND NEW.archived_at IS NULL
     AND NEW.archived_reason IS NULL
  THEN
    -- Mantém operational_status para sinalizar problema pendente.
    -- (Não limpamos automaticamente; só a coleta bem-sucedida limpa.)
    NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_managed_playlist_archive ON public.managed_playlists;
CREATE TRIGGER trg_guard_managed_playlist_archive
BEFORE INSERT OR UPDATE OF archived_at, archived_reason, followers
ON public.managed_playlists
FOR EACH ROW EXECUTE FUNCTION public.guard_managed_playlist_archive();
