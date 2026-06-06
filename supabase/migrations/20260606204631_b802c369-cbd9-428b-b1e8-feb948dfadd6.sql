
CREATE TABLE public.brain_drift_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL,
  canonical_playlist_id uuid,
  diagnosis_id uuid,
  field text NOT NULL,
  brain_value jsonb,
  local_value jsonb,
  diff_pct numeric,
  brain_confidence integer,
  brain_calculated_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_brain_drift_playlist ON public.brain_drift_events(playlist_id, detected_at DESC);
CREATE INDEX idx_brain_drift_field ON public.brain_drift_events(field, detected_at DESC);

GRANT SELECT ON public.brain_drift_events TO authenticated;
GRANT ALL ON public.brain_drift_events TO service_role;

ALTER TABLE public.brain_drift_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can read brain_drift" ON public.brain_drift_events
  FOR SELECT TO authenticated
  USING (public.has_team_access());
