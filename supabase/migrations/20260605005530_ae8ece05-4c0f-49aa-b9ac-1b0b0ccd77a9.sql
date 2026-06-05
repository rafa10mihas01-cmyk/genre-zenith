-- Duplicatas exatas de índices já cobertos por outros
DROP INDEX IF EXISTS public.idx_snapshots_playlist;     -- dup de idx_curator_deal_snapshots_playlist_id (181k scans)
DROP INDEX IF EXISTS public.idx_snapshots_song;         -- dup de idx_curator_deal_snapshots_song_id
DROP INDEX IF EXISTS public.idx_snapshots_deal;         -- dup de idx_curator_deal_snapshots_deal_id (35 scans)

-- Nunca usados (0 idx_scan desde criação)
DROP INDEX IF EXISTS public.idx_cds_deal;
DROP INDEX IF EXISTS public.idx_cds_song;
DROP INDEX IF EXISTS public.idx_cds_playlist;
DROP INDEX IF EXISTS public.idx_cds_captured_at;
DROP INDEX IF EXISTS public.idx_curator_deal_snapshots_song_id;
DROP INDEX IF EXISTS public.idx_curator_deal_snapshots_correlation_id;
DROP INDEX IF EXISTS public.idx_cds_snapshot_run;