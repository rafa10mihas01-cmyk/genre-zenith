
DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname='seo-experiment-measure-daily';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'seo-experiment-measure-daily',
  '30 4 * * *',
  $$
  SELECT net.http_post(
    url:='https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/seo-experiment-measure',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0eHhqbWtpamV5eGtkeXh0dnNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTMwMjAsImV4cCI6MjA5MjIyOTAyMH0.JtoTkhg-uB64Cs-xDqKVHnqM2QydJQpv8I2Q6OI29TM"}'::jsonb,
    body:=concat('{"time":"', now(), '"}')::jsonb
  );
  $$
);
