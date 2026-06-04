
ALTER TABLE public.playlist_execution_jobs
  ADD COLUMN IF NOT EXISTS last_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_validation_status text,
  ADD COLUMN IF NOT EXISTS last_validation_position int;

CREATE TABLE IF NOT EXISTS public.playlist_delivery_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.playlist_execution_jobs(id) ON DELETE CASCADE,
  campaign_id uuid,
  spotify_playlist_id text NOT NULL,
  spotify_track_id text NOT NULL,
  expected_position int,
  actual_position int,
  occurrences int NOT NULL DEFAULT 0,
  status text NOT NULL,
  error text,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdv_job ON public.playlist_delivery_validations(job_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdv_campaign ON public.playlist_delivery_validations(campaign_id, checked_at DESC);

GRANT SELECT ON public.playlist_delivery_validations TO authenticated;
GRANT ALL ON public.playlist_delivery_validations TO service_role;

ALTER TABLE public.playlist_delivery_validations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read validations"
  ON public.playlist_delivery_validations FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "service manages validations"
  ON public.playlist_delivery_validations FOR ALL
  TO service_role USING (true) WITH CHECK (true);
