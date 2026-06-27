-- Agenda o occupancy-executor a cada 1 minuto.
-- Causa raiz: após desativarmos os crons legados (process-catalog-placements-1min
-- e reap-catalog-placements-1min) e migrarmos o ciclo pending->active para o
-- occupancy-executor, nenhum cron.schedule novo foi criado. Sem isso a fila
-- ficou parada (83 pending desde 25/06).

DO $$
BEGIN
  PERFORM cron.unschedule('occupancy-executor-1min');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'occupancy-executor-1min',
  '* * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/occupancy-executor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $cmd$
);