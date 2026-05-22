CREATE TABLE IF NOT EXISTS public.playlist_genres (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  genre_id UUID NOT NULL REFERENCES public.genres(id) ON DELETE CASCADE,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT NOT NULL DEFAULT 'mixed',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  previous_confidence NUMERIC(5,4),
  drift_score NUMERIC(5,4),
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(playlist_id, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_genres_playlist ON public.playlist_genres(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_genres_genre ON public.playlist_genres(genre_id);
CREATE INDEX IF NOT EXISTS idx_playlist_genres_primary ON public.playlist_genres(playlist_id) WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS idx_playlist_genres_confidence ON public.playlist_genres(genre_id, confidence DESC);

ALTER TABLE public.playlist_genres ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_playlist_genres" ON public.playlist_genres
  FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_playlist_genres" ON public.playlist_genres
  FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_playlist_genres" ON public.playlist_genres
  FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_playlist_genres" ON public.playlist_genres
  FOR DELETE TO authenticated USING (has_team_access());

CREATE TRIGGER trg_playlist_genres_set_updated_at
  BEFORE UPDATE ON public.playlist_genres
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();