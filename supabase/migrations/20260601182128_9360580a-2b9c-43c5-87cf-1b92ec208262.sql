-- OTPs e logs de acesso ao portal do curador (espelha campaign_access_*)
CREATE TABLE IF NOT EXISTS public.curator_access_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  email text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.curator_access_otps TO authenticated;
GRANT ALL ON public.curator_access_otps TO service_role;

ALTER TABLE public.curator_access_otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages curator OTPs"
  ON public.curator_access_otps
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS curator_access_otps_lookup_idx
  ON public.curator_access_otps (deal_id, email, code, used_at, expires_at);

CREATE TABLE IF NOT EXISTS public.curator_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  email text NOT NULL,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.curator_access_logs TO authenticated;
GRANT ALL ON public.curator_access_logs TO service_role;

ALTER TABLE public.curator_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages curator access logs"
  ON public.curator_access_logs
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS curator_access_logs_deal_idx
  ON public.curator_access_logs (deal_id, created_at DESC);