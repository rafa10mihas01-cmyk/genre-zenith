-- Tuning autovacuum agressivo pra bot_heartbeats (INSERT a cada 30s × N workers)
ALTER TABLE public.bot_heartbeats SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 100,
  autovacuum_analyze_threshold = 100,
  fillfactor = 90
);

-- Reescreve a tabela fisicamente pra eliminar o bloat de 62MB
-- CLUSTER trava brevemente mas só tem 1472 linhas vivas — instantâneo
CLUSTER public.bot_heartbeats USING bot_heartbeats_pkey;
ANALYZE public.bot_heartbeats;