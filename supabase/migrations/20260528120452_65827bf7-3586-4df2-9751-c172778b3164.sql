ALTER TABLE public.managed_playlist_tracks ADD COLUMN IF NOT EXISTS isrc TEXT;
CREATE INDEX IF NOT EXISTS idx_mpt_isrc ON public.managed_playlist_tracks(isrc) WHERE isrc IS NOT NULL;