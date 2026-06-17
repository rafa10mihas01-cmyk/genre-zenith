
CREATE TABLE IF NOT EXISTS public.client_error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  message text NOT NULL,
  stack text,
  source text,
  lineno integer,
  colno integer,
  url text,
  user_agent text,
  correlation_id text,
  release text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_error_log_created ON public.client_error_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_error_log_user    ON public.client_error_log(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_error_log_corr    ON public.client_error_log(correlation_id) WHERE correlation_id IS NOT NULL;

GRANT INSERT ON public.client_error_log TO anon, authenticated;
GRANT SELECT ON public.client_error_log TO authenticated;
GRANT ALL ON public.client_error_log TO service_role;
ALTER TABLE public.client_error_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_error_log insert any"
  ON public.client_error_log FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "client_error_log admin read"
  ON public.client_error_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "client_error_log service all"
  ON public.client_error_log FOR ALL TO service_role USING (true) WITH CHECK (true);
