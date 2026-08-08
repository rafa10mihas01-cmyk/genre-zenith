CREATE TABLE public.placement_priority_scores_new (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  placement_id uuid NOT NULL UNIQUE,
  score numeric NOT NULL DEFAULT 0,
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.placement_priority_scores_new TO authenticated;
GRANT ALL ON public.placement_priority_scores_new TO service_role;

ALTER TABLE public.placement_priority_scores_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read priority scores" ON public.placement_priority_scores_new
  FOR SELECT TO authenticated USING (has_team_access());

CREATE POLICY "service_role manages priority scores" ON public.placement_priority_scores_new
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_pps_new_score ON public.placement_priority_scores_new (score DESC);
CREATE INDEX idx_pps_new_calc_at ON public.placement_priority_scores_new (calculated_at DESC);