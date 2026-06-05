-- Apaga histórico antigo (mantém 3 dias) e libera ~400MB
DELETE FROM cron.job_run_details WHERE start_time < now() - interval '3 days';

-- Função de retenção pra rodar diariamente
CREATE OR REPLACE FUNCTION public.purge_cron_job_run_details()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, cron
AS $$
  DELETE FROM cron.job_run_details WHERE start_time < now() - interval '3 days';
$$;

REVOKE EXECUTE ON FUNCTION public.purge_cron_job_run_details() FROM PUBLIC, anon, authenticated;

-- Agenda diário às 04:00 UTC (01:00 BRT)
SELECT cron.schedule(
  'purge_cron_job_run_details_daily',
  '0 4 * * *',
  $$SELECT public.purge_cron_job_run_details();$$
);