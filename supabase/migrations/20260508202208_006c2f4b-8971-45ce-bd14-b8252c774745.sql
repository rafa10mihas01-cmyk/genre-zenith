-- ============================================================
-- FILA DE JOBS (modelo queue/worker)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.jobs_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  priority smallint NOT NULL DEFAULT 100,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  attempts smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 3,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  reserved_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  worker_id text,
  correlation_id uuid,
  dedupe_key text,
  duration_ms integer,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_queue_status_check
    CHECK (status IN ('pending','processing','completed','failed','cancelled','retry'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_queue_pending
  ON public.jobs_queue (priority ASC, scheduled_for ASC)
  WHERE status IN ('pending','retry');
CREATE INDEX IF NOT EXISTS idx_jobs_queue_status     ON public.jobs_queue (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_queue_type       ON public.jobs_queue (job_type, status);
CREATE INDEX IF NOT EXISTS idx_jobs_queue_worker     ON public.jobs_queue (worker_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_queue_correlation ON public.jobs_queue (correlation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_queue_dedupe
  ON public.jobs_queue (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('pending','processing','retry');

ALTER TABLE public.jobs_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_select_jobs_queue ON public.jobs_queue;
DROP POLICY IF EXISTS team_insert_jobs_queue ON public.jobs_queue;
DROP POLICY IF EXISTS team_update_jobs_queue ON public.jobs_queue;
DROP POLICY IF EXISTS team_delete_jobs_queue ON public.jobs_queue;
CREATE POLICY team_select_jobs_queue ON public.jobs_queue FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_jobs_queue ON public.jobs_queue FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_jobs_queue ON public.jobs_queue FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_jobs_queue ON public.jobs_queue FOR DELETE TO authenticated USING (has_team_access());

CREATE OR REPLACE FUNCTION public.touch_jobs_queue_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_jobs_queue_updated_at ON public.jobs_queue;
CREATE TRIGGER trg_jobs_queue_updated_at BEFORE UPDATE ON public.jobs_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_jobs_queue_updated_at();

-- ============================================================
-- WORKER HEARTBEATS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id text NOT NULL,
  worker_kind text NOT NULL DEFAULT 'spotify-artists-worker',
  hostname text,
  pid text,
  status text NOT NULL DEFAULT 'idle',
  current_job_id uuid,
  current_job_type text,
  jobs_completed integer NOT NULL DEFAULT 0,
  jobs_failed integer NOT NULL DEFAULT 0,
  cpu_percent numeric,
  mem_percent numeric,
  uptime_seconds bigint,
  agent_version text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_status_check
    CHECK (status IN ('idle','busy','draining','offline','error'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_heartbeats_worker ON public.worker_heartbeats (worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_seen ON public.worker_heartbeats (last_seen_at DESC);

ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_select_worker_heartbeats ON public.worker_heartbeats;
DROP POLICY IF EXISTS team_insert_worker_heartbeats ON public.worker_heartbeats;
DROP POLICY IF EXISTS team_update_worker_heartbeats ON public.worker_heartbeats;
DROP POLICY IF EXISTS team_delete_worker_heartbeats ON public.worker_heartbeats;
CREATE POLICY team_select_worker_heartbeats ON public.worker_heartbeats FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_worker_heartbeats ON public.worker_heartbeats FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_worker_heartbeats ON public.worker_heartbeats FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_worker_heartbeats ON public.worker_heartbeats FOR DELETE TO authenticated USING (has_team_access());

CREATE OR REPLACE FUNCTION public.touch_worker_heartbeats_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_worker_heartbeats_updated_at ON public.worker_heartbeats;
CREATE TRIGGER trg_worker_heartbeats_updated_at BEFORE UPDATE ON public.worker_heartbeats
  FOR EACH ROW EXECUTE FUNCTION public.touch_worker_heartbeats_updated_at();

-- ============================================================
-- JOB INCIDENTS (falhas, timeouts, deadletter)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.job_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs_queue(id) ON DELETE CASCADE,
  worker_id text,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_incident_severity_check CHECK (severity IN ('info','warning','error','critical'))
);
CREATE INDEX IF NOT EXISTS idx_job_incidents_job ON public.job_incidents (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_incidents_open ON public.job_incidents (created_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.job_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_select_job_incidents ON public.job_incidents;
DROP POLICY IF EXISTS team_insert_job_incidents ON public.job_incidents;
DROP POLICY IF EXISTS team_update_job_incidents ON public.job_incidents;
DROP POLICY IF EXISTS team_delete_job_incidents ON public.job_incidents;
CREATE POLICY team_select_job_incidents ON public.job_incidents FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_job_incidents ON public.job_incidents FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_job_incidents ON public.job_incidents FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_job_incidents ON public.job_incidents FOR DELETE TO authenticated USING (has_team_access());

-- ============================================================
-- RPC: claim_next_job — reserva atômica do próximo job
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_next_job(
  p_worker_id text,
  p_job_types text[] DEFAULT NULL,
  p_lease_seconds integer DEFAULT 300
)
RETURNS public.jobs_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs_queue;
BEGIN
  WITH cte AS (
    SELECT id FROM public.jobs_queue
    WHERE status IN ('pending','retry')
      AND scheduled_for <= now()
      AND (p_job_types IS NULL OR job_type = ANY(p_job_types))
    ORDER BY priority ASC, scheduled_for ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.jobs_queue q
     SET status      = 'processing',
         worker_id   = p_worker_id,
         reserved_at = now(),
         started_at  = COALESCE(q.started_at, now()),
         attempts    = q.attempts + 1
    FROM cte
   WHERE q.id = cte.id
   RETURNING q.* INTO v_job;

  RETURN v_job;
END;
$$;

-- ============================================================
-- RPC: complete_job
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_job(
  p_job_id uuid,
  p_worker_id text,
  p_result jsonb DEFAULT '{}'::jsonb
) RETURNS public.jobs_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.jobs_queue;
BEGIN
  UPDATE public.jobs_queue
     SET status      = 'completed',
         result      = COALESCE(p_result, '{}'::jsonb),
         finished_at = now(),
         duration_ms = CASE WHEN started_at IS NOT NULL
                            THEN EXTRACT(EPOCH FROM (now() - started_at))::int * 1000
                            ELSE NULL END,
         error       = NULL
   WHERE id = p_job_id
     AND (worker_id = p_worker_id OR worker_id IS NULL)
  RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

-- ============================================================
-- RPC: fail_job — marca falha, faz retry com backoff exponencial se restar tentativa
-- ============================================================
CREATE OR REPLACE FUNCTION public.fail_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_force_dead boolean DEFAULT false
) RETURNS public.jobs_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job public.jobs_queue;
  v_can_retry boolean;
  v_backoff interval;
BEGIN
  SELECT * INTO v_job FROM public.jobs_queue WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_can_retry := (NOT p_force_dead) AND (v_job.attempts < v_job.max_attempts);
  v_backoff := (LEAST(v_job.attempts, 6) * 30) * INTERVAL '1 second';

  IF v_can_retry THEN
    UPDATE public.jobs_queue
       SET status = 'retry',
           worker_id = NULL,
           reserved_at = NULL,
           scheduled_for = now() + v_backoff,
           error = p_error
     WHERE id = p_job_id
    RETURNING * INTO v_job;
  ELSE
    UPDATE public.jobs_queue
       SET status = 'failed',
           finished_at = now(),
           duration_ms = CASE WHEN started_at IS NOT NULL
                              THEN EXTRACT(EPOCH FROM (now() - started_at))::int * 1000
                              ELSE NULL END,
           error = p_error
     WHERE id = p_job_id
    RETURNING * INTO v_job;
  END IF;

  INSERT INTO public.job_incidents (job_id, worker_id, kind, severity, message)
  VALUES (p_job_id, p_worker_id, 'job_failure',
          CASE WHEN v_can_retry THEN 'warning' ELSE 'error' END,
          COALESCE(p_error, 'unknown'));

  RETURN v_job;
END;
$$;

-- ============================================================
-- RPC: requeue_stale — devolve à fila jobs travados em processing
-- ============================================================
CREATE OR REPLACE FUNCTION public.requeue_stale_jobs(p_lease_seconds integer DEFAULT 600)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  WITH upd AS (
    UPDATE public.jobs_queue
       SET status = 'retry',
           worker_id = NULL,
           reserved_at = NULL,
           scheduled_for = now(),
           error = COALESCE(error, '') || ' [requeued: lease expired]'
     WHERE status = 'processing'
       AND reserved_at < now() - make_interval(secs => p_lease_seconds)
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_next_job(text, text[], integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_job(uuid, text, jsonb)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fail_job(uuid, text, text, boolean)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.requeue_stale_jobs(integer)            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_next_job(text, text[], integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_job(uuid, text, jsonb)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_job(uuid, text, text, boolean)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stale_jobs(integer)            TO authenticated, service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_heartbeats;