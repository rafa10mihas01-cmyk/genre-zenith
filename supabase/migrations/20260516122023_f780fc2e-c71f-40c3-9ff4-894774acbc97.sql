SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'diagnose-managed-playlists-daily' LIMIT 1),
  command := $$
    SELECT net.http_post(
      url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/diagnose-managed-playlists-batch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', public.get_cron_secret()
      ),
      body := jsonb_build_object('limit', 100, 'stale_days', 30)
    );
  $$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'playlist-brain-daily' LIMIT 1),
  command := $$
    SELECT net.http_post(
      url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/playlist-brain-calc',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', public.get_cron_secret()
      ),
      body := jsonb_build_object('batch', true, 'limit', 500)
    );
  $$
);