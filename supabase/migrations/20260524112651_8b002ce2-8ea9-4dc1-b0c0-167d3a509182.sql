-- Onda 2: drops de índices mortos + redução de cadência do execution-planner

-- 1) Drop índices nunca usados (>100KB, idx_scan = 0)
DROP INDEX IF EXISTS public.idx_playlist_brain_signals;
DROP INDEX IF EXISTS public.idx_bot_events_session;
DROP INDEX IF EXISTS public.idx_search_results_nome_norm;
DROP INDEX IF EXISTS public.idx_search_tracks_release;
DROP INDEX IF EXISTS public.idx_plh_playlist_time;

-- 2) Reduzir cadência do execution-planner de 1min para 3min
SELECT cron.alter_job(58, schedule => '*/3 * * * *');