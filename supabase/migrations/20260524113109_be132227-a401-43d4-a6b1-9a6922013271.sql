CREATE INDEX IF NOT EXISTS idx_pms_collected_at_desc
  ON public.playlist_metrics_snapshots (collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_heartbeats_last_collect_at
  ON public.bot_heartbeats (last_collect_at DESC)
  WHERE last_collect_at IS NOT NULL;