-- Foundation para execução manual quando Spotify falha (401/403/429, sem token, colaborativa).
-- Nada do planner, cronograma ou portal é alterado.

CREATE TABLE public.manual_distribution_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NULL,
  campaign_id uuid NULL,
  playlist_id uuid NULL,
  spotify_playlist_id text NULL,
  playlist_name text NULL,
  track_id uuid NULL,
  spotify_track_id text NULL,
  job_type text NULL,
  position integer NULL,
  motivo text NOT NULL,
  status text NOT NULL DEFAULT 'MANUAL_PENDING',
  observacao text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  completed_by uuid NULL
);

CREATE INDEX idx_mdq_status_created ON public.manual_distribution_queue (status, created_at DESC);
CREATE INDEX idx_mdq_campaign ON public.manual_distribution_queue (campaign_id);
CREATE INDEX idx_mdq_job ON public.manual_distribution_queue (job_id);

GRANT SELECT, INSERT, UPDATE ON public.manual_distribution_queue TO authenticated;
GRANT ALL ON public.manual_distribution_queue TO service_role;

ALTER TABLE public.manual_distribution_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins gerenciam fila manual"
  ON public.manual_distribution_queue
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

COMMENT ON TABLE public.manual_distribution_queue IS
  'Itens caídos em modo manual quando Spotify retornou 401/403/429, sem token, owner ausente ou playlist colaborativa. Nunca marca FAILED em playlist_execution_jobs.';