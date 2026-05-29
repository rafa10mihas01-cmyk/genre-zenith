-- Registra schedules canônicos dos crons de leadership no histórico de migrations
-- pra não perder o agendamento em restart/restore. cron.schedule é idempotente
-- por jobname (atualiza schedule se já existir).

DO $$
DECLARE
  v_url_compute text := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/compute-leadership';
  v_url_snap    text := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/snapshot-playlist-leadership';
  v_apikey      text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0eHhqbWtpamV5eGtkeXh0dnNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTMwMjAsImV4cCI6MjA5MjIyOTAyMH0.JtoTkhg-uB64Cs-xDqKVHnqM2QydJQpv8I2Q6OI29TM';
BEGIN
  PERFORM cron.schedule(
    'compute-leadership-daily',
    '30 3 * * *',
    format($cmd$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey', %L, 'Authorization', 'Bearer ' || %L),
        body := jsonb_build_object('source','cron')
      );
    $cmd$, v_url_compute, v_apikey, v_apikey)
  );

  PERFORM cron.schedule(
    'snapshot-leadership-history-daily',
    '45 4 * * *',
    format($cmd$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','apikey', %L, 'Authorization', 'Bearer ' || %L),
        body := jsonb_build_object('source','cron')
      );
    $cmd$, v_url_snap, v_apikey, v_apikey)
  );
END $$;