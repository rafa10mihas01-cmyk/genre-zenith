-- 1) campaign_access_logs: bloqueia escritas via JWT (só service_role insere)
DROP POLICY IF EXISTS "deny_anon_authenticated_writes" ON public.campaign_access_logs;
CREATE POLICY "deny_anon_authenticated_writes"
  ON public.campaign_access_logs
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- 2) spotify_apps: remove acesso direto via API (service_role bypassa RLS)
DROP POLICY IF EXISTS "admin_select_spotify_apps" ON public.spotify_apps;
DROP POLICY IF EXISTS "spotify_apps admin write" ON public.spotify_apps;