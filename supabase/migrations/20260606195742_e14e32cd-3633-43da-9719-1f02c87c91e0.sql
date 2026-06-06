
-- =====================================================================
-- Blindagem Spotify Fase A — estado de saúde + quarentena automática
-- =====================================================================

ALTER TABLE public.spotify_apps
  ADD COLUMN IF NOT EXISTS auth_failure_count    integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_auth_failure_at  timestamptz,
  ADD COLUMN IF NOT EXISTS quarantined_until     timestamptz,
  ADD COLUMN IF NOT EXISTS quarantine_reason     text;

COMMENT ON COLUMN public.spotify_apps.auth_failure_count   IS 'Contador consecutivo de falhas AUTH_INVALID. Zerado em sucesso 2xx.';
COMMENT ON COLUMN public.spotify_apps.last_auth_failure_at IS 'Horário da última falha de auth registrada (qualquer motivo).';
COMMENT ON COLUMN public.spotify_apps.quarantined_until    IS 'Se > now(), app está em quarantined_auto e fora do pool.';
COMMENT ON COLUMN public.spotify_apps.quarantine_reason    IS 'AUTH_MISSING | AUTH_INVALID | RATE_LIMIT | SPOTIFY_5XX | MANUAL';

CREATE INDEX IF NOT EXISTS idx_spotify_apps_pool_health
  ON public.spotify_apps (status, quarantined_until, is_default DESC, created_at ASC);

-- ---------------------------------------------------------------------
-- mark_spotify_app_auth_failure(app_id, reason, retry_after_sec?)
-- Aplica política por motivo. Retorna jsonb com estado pós-update.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_spotify_app_auth_failure(
  p_app_id          uuid,
  p_reason          text,
  p_retry_after_sec integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold       constant integer := 5;
  v_default_minutes constant integer := 30;
  v_ttl_seconds     integer;
  v_new_count       integer;
  v_quarantined     timestamptz;
  v_now             timestamptz := now();
BEGIN
  IF p_app_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'app_id is null');
  END IF;

  IF p_reason NOT IN ('AUTH_MISSING','AUTH_INVALID','RATE_LIMIT','SPOTIFY_5XX','MANUAL') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid reason: ' || p_reason);
  END IF;

  -- SPOTIFY_5XX: nunca quarentena, só registra timestamp
  IF p_reason = 'SPOTIFY_5XX' THEN
    UPDATE public.spotify_apps
       SET last_auth_failure_at = v_now
     WHERE id = p_app_id;
    RETURN jsonb_build_object('ok', true, 'quarantined', false, 'reason', p_reason);
  END IF;

  -- AUTH_INVALID: incrementa contador, quarentena só ao atingir threshold
  IF p_reason = 'AUTH_INVALID' THEN
    UPDATE public.spotify_apps
       SET auth_failure_count   = auth_failure_count + 1,
           last_auth_failure_at = v_now,
           quarantined_until    = CASE
             WHEN auth_failure_count + 1 >= v_threshold
               THEN v_now + (v_default_minutes || ' minutes')::interval
             ELSE quarantined_until
           END,
           quarantine_reason    = CASE
             WHEN auth_failure_count + 1 >= v_threshold THEN p_reason
             ELSE quarantine_reason
           END
     WHERE id = p_app_id
     RETURNING auth_failure_count, quarantined_until
       INTO v_new_count, v_quarantined;

    RETURN jsonb_build_object(
      'ok', true,
      'quarantined', v_new_count >= v_threshold,
      'reason', p_reason,
      'count', v_new_count,
      'threshold', v_threshold,
      'quarantined_until', v_quarantined
    );
  END IF;

  -- AUTH_MISSING e MANUAL: quarentena imediata 30min (MANUAL pode ser estendido por caller)
  -- RATE_LIMIT: quarentena pelo Retry-After (clampeado 2s..6h)
  IF p_reason = 'RATE_LIMIT' THEN
    v_ttl_seconds := GREATEST(2, LEAST(COALESCE(p_retry_after_sec, 60), 21600));
  ELSE
    v_ttl_seconds := v_default_minutes * 60;
  END IF;

  UPDATE public.spotify_apps
     SET last_auth_failure_at = v_now,
         quarantined_until    = v_now + make_interval(secs => v_ttl_seconds),
         quarantine_reason    = p_reason
   WHERE id = p_app_id
   RETURNING quarantined_until INTO v_quarantined;

  RETURN jsonb_build_object(
    'ok', true,
    'quarantined', true,
    'reason', p_reason,
    'ttl_seconds', v_ttl_seconds,
    'quarantined_until', v_quarantined
  );
END;
$$;

-- ---------------------------------------------------------------------
-- reset_spotify_app_auth_failures(app_id)
-- Chamada em sucesso 2xx: zera contador. NÃO mexe em quarantined_until
-- (deixa expirar naturalmente).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_spotify_app_auth_failures(
  p_app_id uuid
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.spotify_apps
     SET auth_failure_count = 0
   WHERE id = p_app_id
     AND auth_failure_count > 0;
$$;

-- ---------------------------------------------------------------------
-- expire_spotify_app_quarantines()
-- Chamada antes da seleção de app: limpa quarentenas vencidas.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_spotify_app_quarantines()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.spotify_apps
     SET quarantined_until = NULL,
         quarantine_reason = NULL,
         auth_failure_count = 0
   WHERE quarantined_until IS NOT NULL
     AND quarantined_until < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_spotify_app_auth_failure(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_spotify_app_auth_failures(uuid)             TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_spotify_app_quarantines()                  TO service_role;
