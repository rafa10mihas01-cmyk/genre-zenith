
CREATE TABLE IF NOT EXISTS public.learning_loop_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'running',
  steps jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  duracao_ms integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_learning_loop_runs_started ON public.learning_loop_runs(started_at DESC);

ALTER TABLE public.learning_loop_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_learning_loop_runs" ON public.learning_loop_runs
  FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_learning_loop_runs" ON public.learning_loop_runs
  FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_learning_loop_runs" ON public.learning_loop_runs
  FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_learning_loop_runs" ON public.learning_loop_runs
  FOR DELETE TO authenticated USING (public.has_team_access());

-- View resumida do estado atual do loop (último run + contadores)
CREATE OR REPLACE FUNCTION public.get_learning_loop_status()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'last_run', (SELECT to_jsonb(r) FROM public.learning_loop_runs r ORDER BY r.started_at DESC LIMIT 1),
    'last_7d_runs', (SELECT count(*) FROM public.learning_loop_runs WHERE started_at > now() - interval '7 days'),
    'last_7d_success', (SELECT count(*) FROM public.learning_loop_runs WHERE started_at > now() - interval '7 days' AND status = 'success'),
    'active_rules', (SELECT count(*) FROM public.replication_rules WHERE active = true),
    'active_rules_high', (SELECT count(*) FROM public.replication_rules WHERE active = true AND priority = 'alta'),
    'last_insight_at', (SELECT max(created_at) FROM public.performance_insights),
    'templates_alta', (SELECT count(*) FROM public.playlist_templates WHERE performance_class = 'alta'),
    'templates_baixa', (SELECT count(*) FROM public.playlist_templates WHERE performance_class = 'baixa')
  );
$$;
