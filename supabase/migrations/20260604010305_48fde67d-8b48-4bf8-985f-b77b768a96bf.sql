-- 1. Restringir leitura das 3 tabelas internas ao time
DROP POLICY IF EXISTS "auth read markers" ON public.realtime_audit_markers;
CREATE POLICY "team read markers" ON public.realtime_audit_markers
  FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS "auth read validations" ON public.playlist_delivery_validations;
CREATE POLICY "team read validations" ON public.playlist_delivery_validations
  FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS "Authenticated can read cache" ON public.spotify_playlist_cache;
CREATE POLICY "team read cache" ON public.spotify_playlist_cache
  FOR SELECT TO authenticated USING (public.has_team_access());

-- 2. Remover acesso de leitura aos tokens Spotify via PostgREST (apenas service_role)
REVOKE SELECT (access_token) ON public.spotify_tokens FROM authenticated, anon;
REVOKE SELECT (access_token, refresh_token) ON public.spotify_user_tokens FROM authenticated, anon;