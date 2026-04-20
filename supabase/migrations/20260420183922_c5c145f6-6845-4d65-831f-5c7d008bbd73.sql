
CREATE TABLE public.playlist_briefings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  genre_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  briefings JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT playlist_briefings_genre_version_unique UNIQUE (genre_id, version)
);

CREATE INDEX idx_playlist_briefings_genre ON public.playlist_briefings(genre_id);
CREATE INDEX idx_playlist_briefings_created ON public.playlist_briefings(created_at DESC);

ALTER TABLE public.playlist_briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_playlist_briefings" ON public.playlist_briefings FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_playlist_briefings" ON public.playlist_briefings FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_playlist_briefings" ON public.playlist_briefings FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_playlist_briefings" ON public.playlist_briefings FOR DELETE TO authenticated USING (has_team_access());
