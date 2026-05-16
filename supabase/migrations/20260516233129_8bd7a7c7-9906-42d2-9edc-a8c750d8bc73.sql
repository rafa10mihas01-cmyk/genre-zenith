
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_fit_id uuid;

CREATE INDEX IF NOT EXISTS idx_curator_deals_source_fit ON public.curator_deals(source_fit_id) WHERE source_fit_id IS NOT NULL;

ALTER TABLE public.recommendation_feedback
  ADD COLUMN IF NOT EXISTS deal_id uuid;

CREATE TABLE IF NOT EXISTS public.recommendation_outcome (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fit_id uuid NOT NULL REFERENCES public.track_playlist_fit(id) ON DELETE CASCADE,
  outcome_kind text NOT NULL DEFAULT 'pending',
  detected_at timestamptz,
  streams_before_28d bigint,
  streams_after_28d bigint,
  impact_delta_pct numeric,
  verdict text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendation_outcome_fit ON public.recommendation_outcome(fit_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_outcome_verdict ON public.recommendation_outcome(verdict) WHERE verdict IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recommendation_outcome_detected ON public.recommendation_outcome(detected_at) WHERE detected_at IS NOT NULL;

ALTER TABLE public.recommendation_outcome ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read recommendation_outcome" ON public.recommendation_outcome;
CREATE POLICY "Authenticated read recommendation_outcome"
  ON public.recommendation_outcome FOR SELECT
  TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_recommendation_outcome_updated_at ON public.recommendation_outcome;
CREATE TRIGGER trg_recommendation_outcome_updated_at
  BEFORE UPDATE ON public.recommendation_outcome
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
