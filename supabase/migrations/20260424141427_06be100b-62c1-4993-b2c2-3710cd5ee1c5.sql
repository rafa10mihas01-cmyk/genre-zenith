-- C.2 — Agenda cleanup_old_logs_and_snapshots todo dia às 04:00 UTC (01:00 BRT)
-- Remove job anterior se existir (idempotente)
DO $$
BEGIN
  PERFORM cron.unschedule('daily-cleanup-logs-snapshots');
EXCEPTION WHEN OTHERS THEN
  -- job não existia, ignora
  NULL;
END $$;

SELECT cron.schedule(
  'daily-cleanup-logs-snapshots',
  '0 4 * * *',
  $$ SELECT public.cleanup_old_logs_and_snapshots(); $$
);
