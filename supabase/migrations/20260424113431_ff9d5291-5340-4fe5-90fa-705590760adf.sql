-- Tabela para orquestrar o pipeline "Usar inteligência" (autopilot)
CREATE TABLE public.autopilot_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  genre_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running', -- running | success | error | partial
  current_step text, -- analyze | briefing | blueprints | templates | covers | approve | replicate | done
  steps_completed jsonb NOT NULL DEFAULT '[]'::jsonb,
  progress_pct integer NOT NULL DEFAULT 0,
  templates_generated integer NOT NULL DEFAULT 0,
  templates_approved integer NOT NULL DEFAULT 0,
  covers_generated integer NOT NULL DEFAULT 0,
  cache_hits jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  error_message text,
  triggered_by text NOT NULL DEFAULT 'manual',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duracao_ms integer
);

ALTER TABLE public.autopilot_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_autopilot_runs" ON public.autopilot_runs
  FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_autopilot_runs" ON public.autopilot_runs
  FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_autopilot_runs" ON public.autopilot_runs
  FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_autopilot_runs" ON public.autopilot_runs
  FOR DELETE TO authenticated USING (has_team_access());

CREATE INDEX idx_autopilot_runs_genre_status ON public.autopilot_runs(genre_id, status, started_at DESC);
CREATE INDEX idx_autopilot_runs_started_at ON public.autopilot_runs(started_at DESC);

ALTER TABLE public.autopilot_runs REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.autopilot_runs;