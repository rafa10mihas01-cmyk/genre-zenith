SELECT cron.alter_job(jobid, active := false)
FROM cron.job
WHERE jobname IN (
  'autopilot-all-genres-hourly',
  'learning-loop-daily',
  'track-playlist-metrics-6h',
  'backfill-dead-genres-6h',
  'weekly-followers-revalidation',
  'cleanup-brain-every-6h',
  'reconcile-genre-counts-daily',
  'reconcile-account-counts-daily',
  'cleanup-old-logs-and-snapshots',
  'daily-cleanup-logs-snapshots',
  'cleanup-stale-autopilot-runs'
);