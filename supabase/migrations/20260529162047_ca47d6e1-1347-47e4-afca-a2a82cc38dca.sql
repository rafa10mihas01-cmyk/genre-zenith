
CREATE TABLE public.spotify_circuit_breaker_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL DEFAULT 'global',
  opened_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz NOT NULL,
  retry_after_sec int NOT NULL DEFAULT 0,
  caused_by text,
  source_function text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.spotify_circuit_breaker_log TO authenticated;
GRANT ALL ON public.spotify_circuit_breaker_log TO service_role;

CREATE INDEX idx_scbl_opened_at ON public.spotify_circuit_breaker_log (opened_at DESC);

ALTER TABLE public.spotify_circuit_breaker_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read CB log"
  ON public.spotify_circuit_breaker_log FOR SELECT
  TO authenticated
  USING (true);
