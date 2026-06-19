
-- 1. Add context column to spotify_circuit_breaker
ALTER TABLE public.spotify_circuit_breaker
  ADD COLUMN IF NOT EXISTS context text NOT NULL DEFAULT 'operation';

ALTER TABLE public.spotify_circuit_breaker
  DROP CONSTRAINT IF EXISTS spotify_circuit_breaker_context_check;
ALTER TABLE public.spotify_circuit_breaker
  ADD CONSTRAINT spotify_circuit_breaker_context_check
  CHECK (context IN ('operation','enrichment'));

-- Troca PK para (app_id, context)
ALTER TABLE public.spotify_circuit_breaker
  DROP CONSTRAINT IF EXISTS spotify_circuit_breaker_pkey;
ALTER TABLE public.spotify_circuit_breaker
  ADD CONSTRAINT spotify_circuit_breaker_pkey PRIMARY KEY (app_id, context);

-- 2. Same for log
ALTER TABLE public.spotify_circuit_breaker_log
  ADD COLUMN IF NOT EXISTS context text NOT NULL DEFAULT 'operation';

ALTER TABLE public.spotify_circuit_breaker_log
  DROP CONSTRAINT IF EXISTS spotify_circuit_breaker_log_context_check;
ALTER TABLE public.spotify_circuit_breaker_log
  ADD CONSTRAINT spotify_circuit_breaker_log_context_check
  CHECK (context IN ('operation','enrichment'));

-- 3. Update get_blocked_playlist_ids — só considera 'operation'
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
    WHERE cb.status = 'open'
      AND cb.blocked_until > now()
      AND cb.context = 'operation'
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

-- 4. Admin RPC: força fechar um breaker específico
CREATE OR REPLACE FUNCTION public.force_close_spotify_circuit_breaker(
  _app_id text,
  _context text DEFAULT 'operation'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF _context NOT IN ('operation','enrichment') THEN
    RAISE EXCEPTION 'invalid context: %', _context;
  END IF;

  UPDATE public.spotify_circuit_breaker
  SET status = 'closed',
      blocked_until = NULL,
      retry_after_sec = 0
  WHERE app_id = _app_id
    AND context = _context;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.force_close_spotify_circuit_breaker(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.force_close_spotify_circuit_breaker(text, text) TO authenticated;

-- 5. Lista breakers abertos por contexto (para UI admin / sistema)
CREATE OR REPLACE FUNCTION public.list_open_spotify_breakers()
RETURNS TABLE (
  app_id text,
  app_name text,
  context text,
  blocked_until timestamptz,
  retry_after_sec integer,
  last_429_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cb.app_id,
         COALESCE(a.name, cb.app_id) AS app_name,
         cb.context,
         cb.blocked_until,
         cb.retry_after_sec,
         cb.last_429_at
  FROM public.spotify_circuit_breaker cb
  LEFT JOIN public.spotify_apps a ON a.id::text = cb.app_id
  WHERE cb.status = 'open'
    AND cb.blocked_until > now()
    AND public.has_team_access()
  ORDER BY cb.blocked_until DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_open_spotify_breakers() TO authenticated;
