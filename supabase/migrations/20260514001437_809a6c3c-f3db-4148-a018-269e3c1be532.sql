CREATE TABLE IF NOT EXISTS public.curator_brain (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  curator_id UUID NOT NULL UNIQUE,
  identity JSONB NOT NULL DEFAULT '{}'::jsonb,
  reliability JSONB NOT NULL DEFAULT '{}'::jsonb,
  economics JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk JSONB NOT NULL DEFAULT '{}'::jsonb,
  capacity_avg_per_deal NUMERIC,
  capacity_p90 NUMERIC,
  delivery_rate_pct INTEGER,
  on_time_rate_pct INTEGER,
  avg_cpp NUMERIC,
  roi_score INTEGER,
  trust_score INTEGER NOT NULL DEFAULT 0,
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence_score INTEGER NOT NULL DEFAULT 0,
  last_calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  calculation_version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_curator_brain_curator ON public.curator_brain(curator_id);
CREATE INDEX IF NOT EXISTS idx_curator_brain_trust ON public.curator_brain(trust_score DESC);

ALTER TABLE public.curator_brain ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_select_curator_brain ON public.curator_brain FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_curator_brain ON public.curator_brain FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_curator_brain ON public.curator_brain FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_curator_brain ON public.curator_brain FOR DELETE TO authenticated USING (has_team_access());

CREATE TRIGGER trg_curator_brain_updated
BEFORE UPDATE ON public.curator_brain
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.curator_brain_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  curator_id UUID NOT NULL,
  trust_score INTEGER,
  delivery_rate_pct INTEGER,
  on_time_rate_pct INTEGER,
  avg_cpp NUMERIC,
  capacity_avg_per_deal NUMERIC,
  signals_count INTEGER NOT NULL DEFAULT 0,
  confidence_score INTEGER NOT NULL DEFAULT 0,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_curator_brain_history_curator ON public.curator_brain_history(curator_id, calculated_at DESC);

ALTER TABLE public.curator_brain_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_select_curator_brain_history ON public.curator_brain_history FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_curator_brain_history ON public.curator_brain_history FOR INSERT TO authenticated WITH CHECK (has_team_access());