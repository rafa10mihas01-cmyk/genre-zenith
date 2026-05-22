
-- Phase 4: drift columns + history
ALTER TABLE public.playlist_genres
  ADD COLUMN IF NOT EXISTS previous_confidence numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drift_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS migration_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trend_shift text;

CREATE TABLE IF NOT EXISTS public.playlist_genre_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  previous_genre_id uuid,
  new_genre_id uuid,
  previous_confidence numeric,
  new_confidence numeric,
  drift_score numeric,
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_by text NOT NULL DEFAULT 'detect-genre-drift',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pgh_playlist ON public.playlist_genre_history(playlist_id, created_at DESC);

ALTER TABLE public.playlist_genre_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage genre history" ON public.playlist_genre_history
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated read genre history" ON public.playlist_genre_history
  FOR SELECT TO authenticated USING (true);
