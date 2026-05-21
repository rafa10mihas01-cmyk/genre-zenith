
-- 1) Remove cron antigo (1x/dia) e cria novo a cada 6h
SELECT cron.unschedule('daily-sync-managed-playlists');

SELECT cron.schedule(
  'sync-managed-playlists-6h',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/sync-managed-playlists',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{"source":"cron-6h"}'::jsonb
  ) AS request_id;
  $$
);

-- 2) Dispara backfill imediato (assíncrono, não bloqueia)
SELECT net.http_post(
  url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/sync-managed-playlists',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-cron-secret', current_setting('app.cron_secret', true)
  ),
  body := '{"source":"manual-backfill"}'::jsonb
);
