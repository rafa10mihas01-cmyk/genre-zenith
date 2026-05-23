-- 1) spotify_apps: restringir SELECT a admins (estava com has_team_access)
DROP POLICY IF EXISTS "team_select_spotify_apps" ON public.spotify_apps;
DROP POLICY IF EXISTS "spotify_apps_team_select" ON public.spotify_apps;
DROP POLICY IF EXISTS "Team can read spotify_apps" ON public.spotify_apps;
DROP POLICY IF EXISTS "spotify_apps_select_team" ON public.spotify_apps;

CREATE POLICY "admin_select_spotify_apps"
ON public.spotify_apps
FOR SELECT
TO authenticated
USING (public.is_current_user_admin());

-- 2) community_members: restringir UPDATE a colunas seguras (não permitir alterar points/tier/status/suspended_*)
DROP POLICY IF EXISTS "member_update_own" ON public.community_members;

CREATE POLICY "member_update_own_safe_fields"
ON public.community_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND points = (SELECT points FROM public.community_members WHERE id = community_members.id)
  AND tier IS NOT DISTINCT FROM (SELECT tier FROM public.community_members WHERE id = community_members.id)
  AND status IS NOT DISTINCT FROM (SELECT status FROM public.community_members WHERE id = community_members.id)
  AND suspended_at IS NOT DISTINCT FROM (SELECT suspended_at FROM public.community_members WHERE id = community_members.id)
  AND suspended_reason IS NOT DISTINCT FROM (SELECT suspended_reason FROM public.community_members WHERE id = community_members.id)
);

-- 3) label_spreadsheet_uploads: adicionar UPDATE pra time
CREATE POLICY "team_update_lsu"
ON public.label_spreadsheet_uploads
FOR UPDATE
TO authenticated
USING (public.has_team_access())
WITH CHECK (public.has_team_access());