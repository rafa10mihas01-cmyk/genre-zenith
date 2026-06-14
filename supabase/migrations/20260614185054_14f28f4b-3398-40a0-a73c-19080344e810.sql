-- 127 = fiscal das campanhas (revalidate-deliveries) — de hora em hora
SELECT cron.alter_job(job_id := 127, schedule := '0 * * * *', active := true);

-- 137 = worker do catálogo — a cada 1 min (já respeita circuit breaker)
SELECT cron.alter_job(job_id := 137, schedule := '* * * * *', active := true);

-- 138 = reaper de placements zumbi — a cada 1 min (não chama Spotify)
SELECT cron.alter_job(job_id := 138, schedule := '* * * * *', active := true);