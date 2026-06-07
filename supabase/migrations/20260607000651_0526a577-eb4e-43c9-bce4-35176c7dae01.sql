CREATE OR REPLACE FUNCTION public.get_blocked_playlist_ids()
RETURNS TABLE (
  playlist_id uuid,
  app_id uuid,
  app_name text,
  blocked_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH blocked_apps AS (
    SELECT a.id, a.name, cb.blocked_until
    FROM public.spotify_apps a
    JOIN public.spotify_circuit_breaker cb ON cb.app_id = a.id::text
    WHERE cb.status = 'open' AND cb.blocked_until > now()
      AND COALESCE(a.retired_from_production, false) = false
  ),
  user_app AS (
    SELECT DISTINCT ON (spotify_user_id) spotify_user_id, app_id
    FROM public.spotify_user_tokens
    ORDER BY spotify_user_id, is_default DESC NULLS LAST, updated_at DESC NULLS LAST
  )
  SELECT mp.id, ba.id, ba.name, ba.blocked_until
  FROM public.managed_playlists mp
  JOIN user_app ua ON ua.spotify_user_id = mp.owner_spotify_user_id
  JOIN blocked_apps ba ON ba.id = ua.app_id::uuid
  WHERE mp.archived_at IS NULL
    AND public.has_team_access();
$$;

GRANT EXECUTE ON FUNCTION public.get_blocked_playlist_ids() TO authenticated;