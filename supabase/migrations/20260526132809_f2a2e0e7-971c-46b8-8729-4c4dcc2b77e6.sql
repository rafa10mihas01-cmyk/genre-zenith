
-- Fix: RESTRICTIVE policy on campaign_access_logs was blocking team SELECT.
-- Scope the write-deny restriction to INSERT/UPDATE/DELETE only so the
-- PERMISSIVE "Team can view access logs" SELECT policy works.
DROP POLICY IF EXISTS deny_anon_authenticated_writes ON public.campaign_access_logs;

CREATE POLICY deny_anon_authenticated_inserts
ON public.campaign_access_logs
AS RESTRICTIVE
FOR INSERT
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY deny_anon_authenticated_updates
ON public.campaign_access_logs
AS RESTRICTIVE
FOR UPDATE
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY deny_anon_authenticated_deletes
ON public.campaign_access_logs
AS RESTRICTIVE
FOR DELETE
TO anon, authenticated
USING (false);

-- Document intent on spotify_apps: service-role only, no client access.
CREATE POLICY "service_role_only_no_client_access"
ON public.spotify_apps
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
