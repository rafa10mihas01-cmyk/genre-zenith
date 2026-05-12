
CREATE TABLE public.playlist_execution_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL DEFAULT 'playlist.track.add' CHECK (job_type IN ('playlist.track.add','playlist.track.remove')),
  allocation_id uuid,
  campaign_id uuid,
  playlist_id uuid,
  spotify_playlist_id text NOT NULL,
  spotify_track_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','done','failed','cancelled')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  last_error text,
  correlation_id uuid,
  dedupe_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX playlist_execution_jobs_dedupe_open
  ON public.playlist_execution_jobs (dedupe_key)
  WHERE status IN ('pending','claimed','failed');

CREATE INDEX playlist_execution_jobs_claim_idx
  ON public.playlist_execution_jobs (status, scheduled_for, lease_expires_at);

CREATE INDEX playlist_execution_jobs_allocation_idx
  ON public.playlist_execution_jobs (allocation_id);

ALTER TABLE public.playlist_execution_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_select_pej ON public.playlist_execution_jobs
  FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_pej ON public.playlist_execution_jobs
  FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_pej ON public.playlist_execution_jobs
  FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_pej ON public.playlist_execution_jobs
  FOR DELETE TO authenticated USING (has_team_access());

CREATE TRIGGER trg_pej_updated_at
  BEFORE UPDATE ON public.playlist_execution_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.playlist_execution_jobs;
