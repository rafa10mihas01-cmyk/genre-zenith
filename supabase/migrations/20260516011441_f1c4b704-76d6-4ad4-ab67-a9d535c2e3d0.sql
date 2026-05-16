SELECT cron.alter_job(jobid, active := true)
FROM cron.job
WHERE jobname = 'track-playlist-metrics-6h';