
-- Spotify Apps em Development Mode — tabela de diagnóstico
CREATE TABLE IF NOT EXISTS public.spotify_app_access_blocks (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  app_id uuid REFERENCES public.spotify_apps(id) ON DELETE SET NULL,
  app_name text,
  client_id text,
  spotify_user_id text,
  spotify_user_name text,
  function_name text,
  endpoint text NOT NULL,
  http_method text NOT NULL DEFAULT 'GET',
  spotify_playlist_id text,
  playlist_name text,
  playlist_owner_id text,
  playlist_owner_name text,
  spotify_track_id text,
  raw_url text,
  error_body text,
  reason text NOT NULL DEFAULT 'app_user_not_whitelisted'
);

CREATE INDEX IF NOT EXISTS idx_sab_app_created ON public.spotify_app_access_blocks(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sab_user_created ON public.spotify_app_access_blocks(spotify_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sab_playlist ON public.spotify_app_access_blocks(spotify_playlist_id);
CREATE INDEX IF NOT EXISTS idx_sab_created ON public.spotify_app_access_blocks(created_at DESC);

GRANT SELECT ON public.spotify_app_access_blocks TO authenticated;
GRANT ALL ON public.spotify_app_access_blocks TO service_role;

ALTER TABLE public.spotify_app_access_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read access blocks"
  ON public.spotify_app_access_blocks
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- View agregada: 1 linha por (app, user, playlist)
CREATE OR REPLACE VIEW public.v_spotify_app_access_blocks_summary AS
SELECT
  b.app_id,
  COALESCE(b.app_name, a.name)                                         AS app_name,
  COALESCE(b.client_id, a.client_id)                                   AS client_id,
  b.spotify_user_id,
  MAX(b.spotify_user_name)                                             AS spotify_user_name,
  b.spotify_playlist_id,
  MAX(b.playlist_name)                                                 AS playlist_name,
  MAX(b.playlist_owner_id)                                             AS playlist_owner_id,
  MAX(b.playlist_owner_name)                                           AS playlist_owner_name,
  CASE WHEN b.spotify_playlist_id IS NOT NULL
       THEN 'https://open.spotify.com/playlist/' || b.spotify_playlist_id
       ELSE NULL END                                                   AS playlist_url,
  CASE WHEN b.spotify_user_id IS NOT NULL
       THEN 'https://open.spotify.com/user/' || b.spotify_user_id
       ELSE NULL END                                                   AS spotify_user_url,
  MAX(b.reason)                                                        AS reason,
  COUNT(*)                                                             AS error_count,
  MIN(b.created_at)                                                    AS first_seen,
  MAX(b.created_at)                                                    AS last_seen,
  MAX(b.error_body)                                                    AS sample_error
FROM public.spotify_app_access_blocks b
LEFT JOIN public.spotify_apps a ON a.id = b.app_id
GROUP BY b.app_id, COALESCE(b.app_name, a.name), COALESCE(b.client_id, a.client_id),
         b.spotify_user_id, b.spotify_playlist_id;

GRANT SELECT ON public.v_spotify_app_access_blocks_summary TO authenticated;

-- RPC para consumo seguro pelo frontend (com check de role)
CREATE OR REPLACE FUNCTION public.get_spotify_app_access_blocks()
RETURNS SETOF public.v_spotify_app_access_blocks_summary
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.v_spotify_app_access_blocks_summary
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY last_seen DESC NULLS LAST, error_count DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_spotify_app_access_blocks() TO authenticated;

-- Backfill a partir do spotify_call_log existente
INSERT INTO public.spotify_app_access_blocks (
  created_at, app_id, app_name, client_id, spotify_user_id,
  function_name, endpoint, http_method,
  spotify_playlist_id, raw_url, error_body, reason
)
SELECT
  l.created_at,
  l.app_id,
  COALESCE(l.app_name, a.name),
  a.client_id,
  l.spotify_user_id,
  l.function_name,
  l.endpoint,
  l.method,
  CASE
    WHEN l.endpoint ~ '/v1/playlists/:id'
    THEN substring(l.endpoint from '/v1/playlists/([^/]+)')
    ELSE NULL
  END,
  NULL,
  l.error_body,
  'app_user_not_whitelisted'
FROM public.spotify_call_log l
LEFT JOIN public.spotify_apps a ON a.id = l.app_id
WHERE l.http_status = 403
  AND l.error_body IS NOT NULL
  AND (
    l.error_body ILIKE '%user may not be registered%'
    OR l.error_body ILIKE '%Check settings on%developer.spotify.com/dashboard%'
  )
  AND l.created_at > now() - interval '30 days';
