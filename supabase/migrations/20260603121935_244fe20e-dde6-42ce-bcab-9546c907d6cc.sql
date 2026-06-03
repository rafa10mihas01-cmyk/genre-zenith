SELECT extensions.pg_stat_statements_reset();
CREATE TABLE IF NOT EXISTS public.realtime_audit_markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marker text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.realtime_audit_markers TO authenticated;
GRANT ALL ON public.realtime_audit_markers TO service_role;
ALTER TABLE public.realtime_audit_markers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read markers" ON public.realtime_audit_markers FOR SELECT TO authenticated USING (true);
INSERT INTO public.realtime_audit_markers(marker) VALUES ('REALTIME_FIX_PHASE_1_T1_RESET');