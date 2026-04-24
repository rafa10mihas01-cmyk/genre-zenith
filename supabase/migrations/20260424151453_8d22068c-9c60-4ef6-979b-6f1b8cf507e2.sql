-- 🚨 Audit #10 A.1 + B.1: cron versionado para watchdog + reconcile

-- Remove agendamento antigo se existir (idempotente)
DO $$
BEGIN
  PERFORM cron.unschedule('spotify-token-watchdog-15min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('spotify-token-watchdog-10min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('reconcile-account-counts-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 🛠️ Watchdog a cada 10 min com header x-cron-secret (lido do Vault)
SELECT cron.schedule(
  'spotify-token-watchdog-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/spotify-token-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 🔧 Reconciliação diária (03:00 UTC) — sincroniza accounts.current_playlists
SELECT cron.schedule(
  'reconcile-account-counts-daily',
  '0 3 * * *',
  $$
  SELECT public.reconcile_account_playlist_counts();
  $$
);