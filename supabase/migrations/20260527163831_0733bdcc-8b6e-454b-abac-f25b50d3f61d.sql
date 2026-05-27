CREATE TABLE IF NOT EXISTS public.playlist_operation_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_id UUID NOT NULL,
  operation TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  tracks_before INTEGER,
  tracks_after INTEGER,
  tracks_changed INTEGER,
  conflict_detected BOOLEAN NOT NULL DEFAULT false,
  retries INTEGER NOT NULL DEFAULT 0,
  divergence_count INTEGER NOT NULL DEFAULT 0,
  lock_timeout BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.playlist_operation_log TO authenticated;
GRANT ALL ON public.playlist_operation_log TO service_role;

ALTER TABLE public.playlist_operation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read playlist operation log"
ON public.playlist_operation_log
FOR SELECT
TO authenticated
USING (public.has_team_access());

CREATE INDEX IF NOT EXISTS idx_pol_playlist_started ON public.playlist_operation_log (playlist_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pol_status ON public.playlist_operation_log (status, started_at DESC);