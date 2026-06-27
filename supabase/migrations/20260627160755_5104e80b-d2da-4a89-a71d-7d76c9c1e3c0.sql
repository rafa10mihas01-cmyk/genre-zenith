
-- 1. Índice único: 1 placement ATIVO por (track, playlist)
CREATE UNIQUE INDEX IF NOT EXISTS ux_catalog_placements_active_track_playlist
  ON public.catalog_placements (catalog_track_id, managed_playlist_id)
  WHERE status = 'active';

-- 2. Liberar leases vencidos (placements presos em 'processing')
CREATE OR REPLACE FUNCTION public.fn_release_expired_placement_leases()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  WITH released AS (
    UPDATE public.catalog_placements
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           locked_at = NULL, locked_by = NULL, lease_expires_at = NULL,
           last_error_code = COALESCE(last_error_code, 'lease_expired')
     WHERE status = 'processing'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM released;
  RETURN v_count;
END;
$$;

-- 3. Promoção wcb → pending quando breaker fechou (auto-recovery)
CREATE OR REPLACE FUNCTION public.fn_promote_waiting_circuit_breaker_to_pending()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  WITH owner_app AS (
    SELECT DISTINCT mp.id AS managed_playlist_id, sut.app_id
      FROM public.managed_playlists mp
      LEFT JOIN public.spotify_user_tokens sut
        ON sut.spotify_user_id = mp.owner_spotify_user_id
  ),
  breaker_open AS (
    SELECT app_id FROM public.spotify_circuit_breaker
     WHERE status = 'open'
        OR (blocked_until IS NOT NULL AND blocked_until > now())
  ),
  promoted AS (
    UPDATE public.catalog_placements cp
       SET status = 'pending',
           scheduled_for = now(),
           last_error_code = NULL,
           locked_at = NULL, locked_by = NULL, lease_expires_at = NULL
      FROM owner_app oa
     WHERE cp.status = 'waiting_circuit_breaker'
       AND cp.managed_playlist_id = oa.managed_playlist_id
       AND cp.attempts < cp.max_attempts
       AND (oa.app_id IS NULL OR oa.app_id NOT IN (SELECT app_id FROM breaker_open))
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM promoted;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_release_expired_placement_leases() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_promote_waiting_circuit_breaker_to_pending() TO service_role;

-- 4. Agendamento — a cada minuto
SELECT cron.unschedule(jobname) FROM cron.job
 WHERE jobname IN ('catalog-placements-release-leases','catalog-placements-promote-wcb');

SELECT cron.schedule(
  'catalog-placements-release-leases',
  '* * * * *',
  $cron$ SELECT public.fn_release_expired_placement_leases(); $cron$
);

SELECT cron.schedule(
  'catalog-placements-promote-wcb',
  '* * * * *',
  $cron$ SELECT public.fn_promote_waiting_circuit_breaker_to_pending(); $cron$
);
