
CREATE TABLE public.curator_outreach_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  external_curator_id UUID REFERENCES public.external_curators(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email','instagram')),
  template_name TEXT,
  recipient_email TEXT,
  recipient_handle TEXT,
  subject TEXT,
  body_snippet TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.curator_outreach_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own outreach"
ON public.curator_outreach_log FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own outreach"
ON public.curator_outreach_log FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own outreach"
ON public.curator_outreach_log FOR UPDATE
USING (auth.uid() = user_id);

CREATE INDEX idx_curator_outreach_log_user ON public.curator_outreach_log(user_id, sent_at DESC);
CREATE INDEX idx_curator_outreach_log_curator ON public.curator_outreach_log(external_curator_id, sent_at DESC);

ALTER TABLE public.external_curators
  ADD COLUMN IF NOT EXISTS last_outreach_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outreach_channel TEXT;
