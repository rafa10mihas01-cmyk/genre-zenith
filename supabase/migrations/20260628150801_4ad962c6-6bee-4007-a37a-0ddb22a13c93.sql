
-- Fix: 4 crons de sync-managed-playlists usavam current_setting('app.cron_secret', true)
-- que retorna NULL (GUC não setada), causando 401 silencioso desde 03/06/2026.
-- Padrão correto (já usado pelos crons de catálogo): public.get_cron_secret().

SELECT cron.unschedule(jobid) FROM cron.job
WHERE jobname IN (
  'sync-managed-hot-6h',
  'sync-managed-warm-24h',
  'sync-managed-cold-72h',
  'sync-managed-catalog-daily'
);

SELECT cron.schedule(
  'sync-managed-hot-6h', '0 */6 * * *',
  $$SELECT net.http_post(
      url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/sync-managed-playlists',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{"source":"cron-hot-6h","tier":"hot","limit":300}'::jsonb
    );$$
);

SELECT cron.schedule(
  'sync-managed-warm-24h', '15 3 * * *',
  $$SELECT net.http_post(
      url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/sync-managed-playlists',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{"source":"cron-warm-24h","tier":"warm","limit":300}'::jsonb
    );$$
);

SELECT cron.schedule(
  'sync-managed-cold-72h', '30 4 */3 * *',
  $$SELECT net.http_post(
      url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/sync-managed-playlists',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{"source":"cron-cold-72h","tier":"cold","limit":300}'::jsonb
    );$$
);

SELECT cron.schedule(
  'sync-managed-catalog-daily', '45 9 * * *',
  $$SELECT net.http_post(
      url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/sync-managed-playlists',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{"source":"cron-catalog","mode":"catalog"}'::jsonb
    );$$
);
