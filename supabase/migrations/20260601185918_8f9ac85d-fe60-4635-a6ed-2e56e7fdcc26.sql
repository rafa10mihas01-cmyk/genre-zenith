CREATE TABLE public.curator_deal_access_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  email text NOT NULL,
  added_by uuid,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, email)
);

CREATE INDEX curator_deal_access_emails_deal_idx ON public.curator_deal_access_emails(deal_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.curator_deal_access_emails TO authenticated;
GRANT ALL ON public.curator_deal_access_emails TO service_role;

ALTER TABLE public.curator_deal_access_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can view curator deal access emails"
  ON public.curator_deal_access_emails FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated can manage curator deal access emails"
  ON public.curator_deal_access_emails FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated can delete curator deal access emails"
  ON public.curator_deal_access_emails FOR DELETE TO authenticated USING (true);