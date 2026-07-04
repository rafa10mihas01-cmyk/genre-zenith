
-- Função de auto-recovery para diagnose_blocked por 403 persistente.
-- Sempre que os apps do Spotify sofrem bloqueio temporário, playlists podem cair
-- em diagnose_blocked=true. Quando o app volta (circuit_breaker=closed) essas
-- playlists precisam voltar automaticamente à operação.
CREATE OR REPLACE FUNCTION public.fn_unblock_diagnose_403_recovered()
RETURNS TABLE(unblocked_count int, playlist_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_any_circuit_open boolean;
  v_ids uuid[];
BEGIN
  -- Existe algum circuit breaker de operação aberto agora?
  SELECT EXISTS (
    SELECT 1 FROM public.spotify_circuit_breaker
    WHERE context = 'operation'
      AND status = 'open'
      AND (blocked_until IS NULL OR blocked_until > now())
  ) INTO v_any_circuit_open;

  -- Se ainda há circuit aberto, não reabre nada (evita loop de re-bloqueio).
  IF v_any_circuit_open THEN
    RETURN QUERY SELECT 0, ARRAY[]::uuid[];
    RETURN;
  END IF;

  -- Reabre playlists bloqueadas por 403_persistent há mais de 30 minutos.
  -- O streak zera para permitir que, se o problema persistir, o bloqueio volte
  -- normalmente após 3 novas falhas.
  WITH upd AS (
    UPDATE public.managed_playlists
       SET diagnose_blocked = false,
           diagnose_blocked_reason = NULL,
           diagnose_blocked_at = NULL,
           diagnose_403_streak = 0,
           updated_at = now()
     WHERE diagnose_blocked = true
       AND diagnose_blocked_reason LIKE '403_persistent%'
       AND diagnose_blocked_at < now() - interval '30 minutes'
       AND (playlist_type IS NULL OR playlist_type <> 'ARCHIVED')
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM upd;

  RETURN QUERY SELECT COALESCE(array_length(v_ids,1),0), COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_unblock_diagnose_403_recovered() TO service_role;

-- Agenda cron para rodar a cada 10 minutos.
-- pg_cron já está habilitado no projeto (usado por outros jobs).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-unblock-diagnose-403') THEN
    PERFORM cron.unschedule('auto-unblock-diagnose-403');
  END IF;
  PERFORM cron.schedule(
    'auto-unblock-diagnose-403',
    '*/10 * * * *',
    $CRON$ SELECT public.fn_unblock_diagnose_403_recovered(); $CRON$
  );
END $$;
