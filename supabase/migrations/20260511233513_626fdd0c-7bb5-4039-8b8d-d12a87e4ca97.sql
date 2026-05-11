-- Schedule daily recalc of playlist scores
DO $$
BEGIN
  PERFORM cron.unschedule('recalc-playlist-scores-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'recalc-playlist-scores-daily',
  '15 3 * * *',
  $cron$ SELECT public.recalc_playlist_scores(); $cron$
);