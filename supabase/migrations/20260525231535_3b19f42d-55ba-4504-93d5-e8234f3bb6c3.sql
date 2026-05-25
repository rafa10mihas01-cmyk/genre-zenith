-- 1) campaign_access_emails: restrict to campaign owner or admin
DROP POLICY IF EXISTS "Authenticated users can view authorized emails" ON public.campaign_access_emails;
DROP POLICY IF EXISTS "Authenticated users can add authorized emails" ON public.campaign_access_emails;
DROP POLICY IF EXISTS "Authenticated users can delete authorized emails" ON public.campaign_access_emails;

CREATE POLICY "Campaign owners or admins can view authorized emails"
  ON public.campaign_access_emails
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_access_emails.campaign_id
        AND c.created_by = auth.uid()
    )
  );

CREATE POLICY "Campaign owners or admins can add authorized emails"
  ON public.campaign_access_emails
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_access_emails.campaign_id
        AND c.created_by = auth.uid()
    )
  );

CREATE POLICY "Campaign owners or admins can delete authorized emails"
  ON public.campaign_access_emails
  FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_access_emails.campaign_id
        AND c.created_by = auth.uid()
    )
  );

-- 2) campaign_access_otps: explicit deny-all for clients (only service role uses it)
CREATE POLICY "No direct client access to OTPs"
  ON public.campaign_access_otps
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);