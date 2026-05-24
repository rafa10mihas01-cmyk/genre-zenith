CREATE INDEX IF NOT EXISTS idx_pfs_captured_at ON public.playlist_followers_snapshots (captured_at);
CREATE INDEX IF NOT EXISTS idx_pts_captured_at ON public.playlist_track_snapshots (captured_at);
CREATE INDEX IF NOT EXISTS idx_pds_captured_at ON public.playlist_drift_snapshots (captured_at);
CREATE INDEX IF NOT EXISTS idx_cds_captured_at ON public.curator_deal_snapshots (captured_at);
CREATE INDEX IF NOT EXISTS idx_ces_captured_at ON public.campaign_eco_snapshots (captured_at);