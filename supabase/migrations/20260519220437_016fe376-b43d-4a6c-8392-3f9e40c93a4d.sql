-- Fase 2 — Experimentos SEO
CREATE TABLE IF NOT EXISTS public.playlist_seo_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  genre_id uuid REFERENCES public.genres(id),
  field text NOT NULL CHECK (field IN ('name','description')),
  pattern_key text,
  pattern_label text,
  version_before text NOT NULL,
  version_after text NOT NULL,
  reasoning text,
  suggestion_source text NOT NULL DEFAULT 'ai',
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','active','completed','rolled_back','rejected')),
  baseline_followers bigint,
  baseline_at timestamptz,
  applied_at timestamptz,
  measure_due_at timestamptz,
  measured_followers bigint,
  measured_at timestamptz,
  delta_followers bigint,
  delta_pct numeric,
  outcome text CHECK (outcome IN ('positive','neutral','negative')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seo_exp_playlist ON public.playlist_seo_experiments(playlist_id);
CREATE INDEX IF NOT EXISTS idx_seo_exp_status_due
  ON public.playlist_seo_experiments(status, measure_due_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_seo_exp_genre_outcome
  ON public.playlist_seo_experiments(genre_id, outcome) WHERE outcome IS NOT NULL;

ALTER TABLE public.playlist_seo_experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_seo_exp"
  ON public.playlist_seo_experiments FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_seo_exp"
  ON public.playlist_seo_experiments FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_seo_exp"
  ON public.playlist_seo_experiments FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_seo_exp"
  ON public.playlist_seo_experiments FOR DELETE TO authenticated USING (has_team_access());

CREATE TRIGGER trg_seo_exp_updated
  BEFORE UPDATE ON public.playlist_seo_experiments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Lições agregadas por nicho
CREATE TABLE IF NOT EXISTS public.seo_genre_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid NOT NULL REFERENCES public.genres(id) ON DELETE CASCADE,
  pattern_key text NOT NULL,
  pattern_label text NOT NULL,
  field text NOT NULL CHECK (field IN ('name','description')),
  samples_count integer NOT NULL DEFAULT 0,
  positive_count integer NOT NULL DEFAULT 0,
  neutral_count integer NOT NULL DEFAULT 0,
  negative_count integer NOT NULL DEFAULT 0,
  avg_delta_pct numeric,
  confidence numeric,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (genre_id, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_seo_lessons_genre ON public.seo_genre_lessons(genre_id);

ALTER TABLE public.seo_genre_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_seo_lessons"
  ON public.seo_genre_lessons FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_modify_seo_lessons"
  ON public.seo_genre_lessons FOR ALL TO authenticated
  USING (has_team_access()) WITH CHECK (has_team_access());