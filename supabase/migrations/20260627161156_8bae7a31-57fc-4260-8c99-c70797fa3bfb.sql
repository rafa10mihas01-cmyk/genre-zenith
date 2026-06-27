
CREATE OR REPLACE FUNCTION public.fn_promote_waiting_circuit_breaker_to_pending()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  WITH owner_app AS (
    SELECT DISTINCT mp.id AS managed_playlist_id, sut.app_id::text AS app_id
      FROM public.managed_playlists mp
      LEFT JOIN public.spotify_user_tokens sut
        ON sut.spotify_user_id = mp.owner_spotify_user_id
  ),
  breaker_open AS (
    SELECT app_id::text AS app_id FROM public.spotify_circuit_breaker
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
