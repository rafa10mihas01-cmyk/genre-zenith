CREATE TABLE IF NOT EXISTS public._io_stats_snapshots (
  id BIGSERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  relname TEXT NOT NULL,
  seq_scan BIGINT,
  seq_tup_read BIGINT,
  idx_scan BIGINT,
  idx_tup_fetch BIGINT,
  n_tup_ins BIGINT,
  n_tup_upd BIGINT,
  n_tup_del BIGINT,
  n_live_tup BIGINT
);
GRANT ALL ON public._io_stats_snapshots TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public._io_stats_snapshots_id_seq TO service_role;
ALTER TABLE public._io_stats_snapshots ENABLE ROW LEVEL SECURITY;

INSERT INTO public._io_stats_snapshots
  (label, relname, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup)
SELECT 'post_rls_baseline_20260603', relname, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup
FROM pg_stat_user_tables;