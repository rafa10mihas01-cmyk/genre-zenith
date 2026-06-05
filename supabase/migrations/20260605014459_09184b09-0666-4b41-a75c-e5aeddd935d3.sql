SELECT cron.unschedule('bot-execution-queue-internal-1min');
SELECT cron.schedule(
  'bot-execution-queue-internal-1min',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/bot-execution-queue?limit=10',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);