CREATE TABLE public.managed_playlists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  spotify_playlist_id TEXT NOT NULL UNIQUE,
  spotify_url TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  cover_url TEXT,
  followers BIGINT NOT NULL DEFAULT 0,
  tracks_count INTEGER NOT NULL DEFAULT 0,
  genre_id UUID,
  account_id UUID,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by UUID,
  archived_at TIMESTAMPTZ,
  last_metrics_at TIMESTAMPTZ,
  last_diagnosis_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_managed_playlists_genre ON public.managed_playlists(genre_id);
CREATE INDEX idx_managed_playlists_archived ON public.managed_playlists(archived_at);
ALTER TABLE public.managed_playlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_select_managed_playlists ON public.managed_playlists FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_managed_playlists ON public.managed_playlists FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_managed_playlists ON public.managed_playlists FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_managed_playlists ON public.managed_playlists FOR DELETE TO authenticated USING (has_team_access());
CREATE TRIGGER trg_managed_playlists_updated
BEFORE UPDATE ON public.managed_playlists
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.playlist_diagnoses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_id UUID NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  name_score NUMERIC,
  name_current TEXT,
  name_suggestion TEXT,
  name_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  tracks_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  cover_suggestion JSONB NOT NULL DEFAULT '{}'::jsonb,
  competitors JSONB NOT NULL DEFAULT '[]'::jsonb,
  applied_changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  applied_at TIMESTAMPTZ,
  applied_by UUID,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_playlist_diagnoses_playlist ON public.playlist_diagnoses(playlist_id, created_at DESC);
ALTER TABLE public.playlist_diagnoses ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_select_playlist_diagnoses ON public.playlist_diagnoses FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_playlist_diagnoses ON public.playlist_diagnoses FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_playlist_diagnoses ON public.playlist_diagnoses FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_playlist_diagnoses ON public.playlist_diagnoses FOR DELETE TO authenticated USING (has_team_access());

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT jobname FROM cron.job
    WHERE jobname ILIKE '%auto-replicate%'
       OR jobname ILIKE '%auto-adjust%'
       OR jobname ILIKE '%autopilot%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;