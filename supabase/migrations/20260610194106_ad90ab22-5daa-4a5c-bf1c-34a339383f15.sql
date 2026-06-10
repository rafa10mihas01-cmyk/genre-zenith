CREATE OR REPLACE FUNCTION public.get_cron_last_success(p_fn_name text)
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT MAX(jrd.start_time)
  FROM cron.job_run_details jrd
  JOIN cron.job j ON j.jobid = jrd.jobid
  WHERE jrd.status = 'succeeded'
    AND j.command ILIKE '%/functions/v1/' || p_fn_name || '%'
$$;

GRANT EXECUTE ON FUNCTION public.get_cron_last_success(text) TO service_role;