
-- Passo 1: Ponte de identidade song_snapshots ↔ catalog_tracks
ALTER TABLE public.song_snapshots
  ADD COLUMN IF NOT EXISTS catalog_track_id uuid NULL REFERENCES public.catalog_tracks(id) ON DELETE CASCADE;

ALTER TABLE public.song_snapshots
  ALTER COLUMN song_id DROP NOT NULL;

ALTER TABLE public.song_snapshots
  DROP CONSTRAINT IF EXISTS song_snapshots_target_chk;

ALTER TABLE public.song_snapshots
  ADD CONSTRAINT song_snapshots_target_chk
  CHECK (song_id IS NOT NULL OR catalog_track_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_song_snapshots_catalog_track
  ON public.song_snapshots (catalog_track_id, captured_at DESC)
  WHERE catalog_track_id IS NOT NULL;

COMMENT ON COLUMN public.song_snapshots.catalog_track_id IS
  'Quando preenchido, este snapshot pertence ao módulo Catálogo (não a um deal). VPS preenche este campo ao processar alvos de catalog_snapshot_queue.';
