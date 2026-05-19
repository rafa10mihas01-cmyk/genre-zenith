
SELECT cron.unschedule('process-email-queue');
SELECT cron.schedule(
  'process-email-queue',
  '* * * * *',
  $$SELECT net.http_post(
    url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/process-email-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0eHhqbWtpamV5eGtkeXh0dnNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTMwMjAsImV4cCI6MjA5MjIyOTAyMH0.JtoTkhg-uB64Cs-xDqKVHnqM2QydJQpv8I2Q6OI29TM',
      'x-cron-secret', public.get_cron_secret()
    ),
    body := '{}'::jsonb
  );$$
);
