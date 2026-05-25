
CREATE TABLE public.campaign_access_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  email text NOT NULL,
  added_by uuid,
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uidx_campaign_access_emails_lower
  ON public.campaign_access_emails(campaign_id, lower(email));
CREATE INDEX idx_campaign_access_emails_campaign ON public.campaign_access_emails(campaign_id);
ALTER TABLE public.campaign_access_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view authorized emails"
  ON public.campaign_access_emails FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can add authorized emails"
  ON public.campaign_access_emails FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete authorized emails"
  ON public.campaign_access_emails FOR DELETE TO authenticated USING (true);

CREATE TABLE public.campaign_access_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  email text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used_at timestamptz
);
CREATE INDEX idx_campaign_access_otps_lookup ON public.campaign_access_otps(campaign_id, email, code);
CREATE INDEX idx_campaign_access_otps_created ON public.campaign_access_otps(created_at);
ALTER TABLE public.campaign_access_otps ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.campaign_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  email text NOT NULL,
  ip text,
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaign_access_logs_campaign ON public.campaign_access_logs(campaign_id, accessed_at DESC);
ALTER TABLE public.campaign_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view access logs"
  ON public.campaign_access_logs FOR SELECT TO authenticated USING (true);
