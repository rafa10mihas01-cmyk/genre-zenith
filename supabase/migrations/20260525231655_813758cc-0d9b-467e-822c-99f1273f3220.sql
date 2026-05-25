-- campaign_access_emails: replace owner/admin policies with team-based access
DROP POLICY IF EXISTS "Campaign owners or admins can view authorized emails" ON public.campaign_access_emails;
DROP POLICY IF EXISTS "Campaign owners or admins can add authorized emails" ON public.campaign_access_emails;
DROP POLICY IF EXISTS "Campaign owners or admins can delete authorized emails" ON public.campaign_access_emails;

CREATE POLICY "Team can view authorized emails"
  ON public.campaign_access_emails FOR SELECT
  TO authenticated
  USING (public.has_team_access());

CREATE POLICY "Team can add authorized emails"
  ON public.campaign_access_emails FOR INSERT
  TO authenticated
  WITH CHECK (public.has_team_access());

CREATE POLICY "Team can delete authorized emails"
  ON public.campaign_access_emails FOR DELETE
  TO authenticated
  USING (public.has_team_access());

-- campaign_access_logs: restrict SELECT to team members
DROP POLICY IF EXISTS "Authenticated users can view access logs" ON public.campaign_access_logs;

CREATE POLICY "Team can view access logs"
  ON public.campaign_access_logs FOR SELECT
  TO authenticated
  USING (public.has_team_access());