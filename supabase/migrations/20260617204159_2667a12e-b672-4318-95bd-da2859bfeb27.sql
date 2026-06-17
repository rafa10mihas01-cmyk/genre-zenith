
-- Phase 4.E: cron hardening — advisory locks + dead-job reaper.

CREATE OR REPLACE FUNCTION public.cron_try_advisory_lock(p_key bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_try_advisory_lock(p_key);
$$;

CREATE OR REPLACE FUNCTION public.cron_advisory_unlock(p_key bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(p_key);
$$;

REVOKE ALL ON FUNCTION public.cron_try_advisory_lock(bigint) FROM public;
REVOKE ALL ON FUNCTION public.cron_advisory_unlock(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.cron_try_advisory_lock(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_advisory_unlock(bigint) TO service_role;

-- Dead-job reaper: marca runs sem finished_at há mais de 15min como falha.
CREATE OR REPLACE FUNCTION public.reap_dead_cron_runs(p_max_age_minutes int DEFAULT 15)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  UPDATE public.cron_run_log
     SET finished_at = now(),
         success = false,
         error_message = COALESCE(error_message, 'reaped: no finish signal within ' || p_max_age_minutes || ' min'),
         duration_ms = EXTRACT(EPOCH FROM (now() - started_at))::int * 1000
   WHERE finished_at IS NULL
     AND started_at < now() - (p_max_age_minutes || ' minutes')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reap_dead_cron_runs(int) TO service_role;

-- Indexes pra dashboards de observabilidade e o próprio reaper.
CREATE INDEX IF NOT EXISTS cron_run_log_unfinished_idx
  ON public.cron_run_log (started_at)
  WHERE finished_at IS NULL;

CREATE INDEX IF NOT EXISTS cron_run_log_name_started_idx
  ON public.cron_run_log (cron_name, started_at DESC);

-- Agenda o reaper a cada 10 minutos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('reap-dead-cron-runs-10min')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reap-dead-cron-runs-10min');
    PERFORM cron.schedule(
      'reap-dead-cron-runs-10min',
      '*/10 * * * *',
      $cron$ SELECT public.reap_dead_cron_runs(15); $cron$
    );
  END IF;
END $$;
