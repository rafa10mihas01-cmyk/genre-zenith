
CREATE TABLE public.system_flags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  apify_blocked BOOLEAN NOT NULL DEFAULT false,
  apify_blocked_at TIMESTAMP WITH TIME ZONE,
  apify_blocked_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.system_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_system_flags" ON public.system_flags FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_system_flags" ON public.system_flags FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_system_flags" ON public.system_flags FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_system_flags" ON public.system_flags FOR DELETE TO authenticated USING (has_team_access());

CREATE TRIGGER touch_system_flags_updated_at BEFORE UPDATE ON public.system_flags
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Linha única (singleton)
INSERT INTO public.system_flags (apify_blocked) VALUES (false);
