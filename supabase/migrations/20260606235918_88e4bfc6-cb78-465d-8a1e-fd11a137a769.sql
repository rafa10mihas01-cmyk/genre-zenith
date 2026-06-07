
DROP FUNCTION IF EXISTS public.get_spotify_apps_status();
DROP FUNCTION IF EXISTS public.get_spotify_app_for_playlist(uuid);

CREATE OR REPLACE FUNCTION public.get_spotify_apps_status()
RETURNS TABLE (
  app_id uuid,
  app_name text,
  app_status text,
  auth_failure_count integer,
  quarantined_until timestamptz,
  circuit_status text,
  blocked_until timestamptz,
  retry_after_sec integer,
  last_429_at timestamptz,
  playlists_count bigint,
  level text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH user_app AS (
    SELECT DISTINCT ON (spotify_user_id) spotify_user_id, app_id
    FROM public.spotify_user_tokens
    ORDER BY spotify_user_id, is_default DESC NULLS LAST, updated_at DESC NULLS LAST
  ),
  counts AS (
    SELECT ua.app_id::uuid AS app_id, COUNT(*)::bigint AS n
    FROM public.managed_playlists mp
    JOIN user_app ua ON ua.spotify_user_id = mp.owner_spotify_user_id
    WHERE mp.archived_at IS NULL
    GROUP BY ua.app_id
  )
  SELECT
    a.id,
    a.name,
    a.status::text,
    COALESCE(a.auth_failure_count, 0),
    a.quarantined_until,
    COALESCE(cb.status, 'closed')::text,
    CASE WHEN cb.status = 'open' AND cb.blocked_until > now() THEN cb.blocked_until ELSE NULL END,
    COALESCE(cb.retry_after_sec, 0),
    cb.last_429_at,
    COALESCE(c.n, 0)::bigint,
    CASE
      WHEN cb.status = 'open' AND cb.blocked_until > now() THEN 'blocked'
      WHEN a.status = 'quarantined' OR COALESCE(a.auth_failure_count, 0) >= 3 THEN 'attention'
      ELSE 'healthy'
    END::text
  FROM public.spotify_apps a
  LEFT JOIN public.spotify_circuit_breaker cb ON cb.app_id = a.id::text
  LEFT JOIN counts c ON c.app_id = a.id
  WHERE COALESCE(a.retired_from_production, false) = false
    AND public.has_team_access()
  ORDER BY
    CASE
      WHEN cb.status = 'open' AND cb.blocked_until > now() THEN 0
      WHEN a.status = 'quarantined' OR COALESCE(a.auth_failure_count, 0) >= 3 THEN 1
      ELSE 2
    END,
    a.name;
$$;

GRANT EXECUTE ON FUNCTION public.get_spotify_apps_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_spotify_app_for_playlist(p_playlist_id uuid)
RETURNS TABLE (
  app_id uuid,
  app_name text,
  app_status text,
  auth_failure_count integer,
  circuit_status text,
  blocked_until timestamptz,
  retry_after_sec integer,
  playlists_count bigint,
  level text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH target AS (
    SELECT mp.owner_spotify_user_id
    FROM public.managed_playlists mp
    WHERE mp.id = p_playlist_id
  ),
  tok AS (
    SELECT app_id
    FROM public.spotify_user_tokens
    WHERE spotify_user_id = (SELECT owner_spotify_user_id FROM target)
    ORDER BY is_default DESC NULLS LAST, updated_at DESC NULLS LAST
    LIMIT 1
  ),
  cnt AS (
    SELECT COUNT(*)::bigint AS n
    FROM public.managed_playlists mp
    JOIN public.spotify_user_tokens t ON t.spotify_user_id = mp.owner_spotify_user_id
    WHERE t.app_id::uuid = (SELECT app_id::uuid FROM tok) AND mp.archived_at IS NULL
  )
  SELECT
    a.id,
    a.name,
    a.status::text,
    COALESCE(a.auth_failure_count, 0),
    COALESCE(cb.status, 'closed')::text,
    CASE WHEN cb.status = 'open' AND cb.blocked_until > now() THEN cb.blocked_until ELSE NULL END,
    COALESCE(cb.retry_after_sec, 0),
    COALESCE((SELECT n FROM cnt), 0)::bigint,
    CASE
      WHEN cb.status = 'open' AND cb.blocked_until > now() THEN 'blocked'
      WHEN a.status = 'quarantined' OR COALESCE(a.auth_failure_count, 0) >= 3 THEN 'attention'
      ELSE 'healthy'
    END::text
  FROM public.spotify_apps a
  LEFT JOIN public.spotify_circuit_breaker cb ON cb.app_id = a.id::text
  WHERE a.id = (SELECT app_id::uuid FROM tok)
    AND public.has_team_access();
$$;

GRANT EXECUTE ON FUNCTION public.get_spotify_app_for_playlist(uuid) TO authenticated;
