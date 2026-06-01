-- Restringir políticas RLS de curator_deal_access_emails ao dono do deal
DROP POLICY IF EXISTS "authenticated can manage curator deal access emails" ON public.curator_deal_access_emails;
DROP POLICY IF EXISTS "authenticated can delete curator deal access emails" ON public.curator_deal_access_emails;
DROP POLICY IF EXISTS "authenticated can view curator deal access emails" ON public.curator_deal_access_emails;

CREATE POLICY "deal owner can view curator deal access emails"
ON public.curator_deal_access_emails
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.curator_deals d
  WHERE d.id = curator_deal_access_emails.deal_id AND d.user_id = auth.uid()
));

CREATE POLICY "deal owner can insert curator deal access emails"
ON public.curator_deal_access_emails
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.curator_deals d
  WHERE d.id = curator_deal_access_emails.deal_id AND d.user_id = auth.uid()
));

CREATE POLICY "deal owner can delete curator deal access emails"
ON public.curator_deal_access_emails
FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.curator_deals d
  WHERE d.id = curator_deal_access_emails.deal_id AND d.user_id = auth.uid()
));