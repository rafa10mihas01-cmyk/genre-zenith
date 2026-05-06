
-- bot_print_batches: adicionar FKs faltantes
ALTER TABLE public.bot_print_batches
  ADD CONSTRAINT bot_print_batches_deal_id_fkey
  FOREIGN KEY (deal_id) REFERENCES public.curator_deals(id) ON DELETE CASCADE;

ALTER TABLE public.bot_print_batches
  ADD CONSTRAINT bot_print_batches_song_id_fkey
  FOREIGN KEY (song_id) REFERENCES public.curator_deal_songs(id) ON DELETE CASCADE;

-- Ajustar logs.song_id de SET NULL para CASCADE
ALTER TABLE public.curator_deal_logs DROP CONSTRAINT curator_deal_logs_song_id_fkey;
ALTER TABLE public.curator_deal_logs
  ADD CONSTRAINT curator_deal_logs_song_id_fkey
  FOREIGN KEY (song_id) REFERENCES public.curator_deal_songs(id) ON DELETE CASCADE;

-- Ajustar snapshots.song_id de SET NULL para CASCADE
ALTER TABLE public.curator_deal_snapshots DROP CONSTRAINT curator_deal_snapshots_song_id_fkey;
ALTER TABLE public.curator_deal_snapshots
  ADD CONSTRAINT curator_deal_snapshots_song_id_fkey
  FOREIGN KEY (song_id) REFERENCES public.curator_deal_songs(id) ON DELETE CASCADE;

-- Índices para performance dos FKs
CREATE INDEX IF NOT EXISTS idx_bot_print_batches_deal_id ON public.bot_print_batches(deal_id);
CREATE INDEX IF NOT EXISTS idx_bot_print_batches_song_id ON public.bot_print_batches(song_id);
CREATE INDEX IF NOT EXISTS idx_curator_deal_snapshots_deal_id ON public.curator_deal_snapshots(deal_id);
CREATE INDEX IF NOT EXISTS idx_curator_deal_snapshots_song_id ON public.curator_deal_snapshots(song_id);
CREATE INDEX IF NOT EXISTS idx_curator_deal_snapshots_playlist_id ON public.curator_deal_snapshots(playlist_id);
CREATE INDEX IF NOT EXISTS idx_curator_deal_logs_deal_id ON public.curator_deal_logs(deal_id);
CREATE INDEX IF NOT EXISTS idx_curator_deal_logs_song_id ON public.curator_deal_logs(song_id);
CREATE INDEX IF NOT EXISTS idx_curator_playlists_deal_id ON public.curator_playlists(deal_id);
CREATE INDEX IF NOT EXISTS idx_curator_playlists_song_id ON public.curator_playlists(song_id);
