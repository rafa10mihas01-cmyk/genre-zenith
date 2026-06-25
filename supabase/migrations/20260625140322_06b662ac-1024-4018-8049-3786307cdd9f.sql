-- Fase 6 (Snapshot Único): desativa cron legado que chamava playlist-brain-calc em batch.
-- O recálculo do Cérebro agora é uma etapa do Analysis Snapshot, disparada pelos crons
-- sync-managed-hot-6h / warm-24h / cold-72h via analysis-orchestrator.
SELECT cron.alter_job(job_id := 35, active := false);