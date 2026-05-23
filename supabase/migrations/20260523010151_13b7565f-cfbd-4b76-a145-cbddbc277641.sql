ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS suggested_genre_id uuid REFERENCES public.genres(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggestion_confidence integer,
  ADD COLUMN IF NOT EXISTS suggestion_reason text,
  ADD COLUMN IF NOT EXISTS suggested_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_managed_playlists_suggested_genre
  ON public.managed_playlists (suggested_genre_id)
  WHERE genre_id IS NULL AND archived_at IS NULL;