-- ============================================================
-- Replication module: blueprints + templates
-- ============================================================

CREATE TABLE public.playlist_blueprints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  genre_id UUID NOT NULL,
  tier TEXT NOT NULL DEFAULT 'medium', -- mega | big | medium | small
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  name_pattern TEXT,
  format TEXT,
  mood TEXT,
  cover_style JSONB DEFAULT '{}'::jsonb,
  track_dna JSONB DEFAULT '{}'::jsonb,
  source_playlists JSONB DEFAULT '[]'::jsonb,
  sample_size INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'media', -- alta | media | baixa
  notes TEXT,
  replication_score NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', -- active | archived
  generated_by_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pl_blueprints_genre ON public.playlist_blueprints(genre_id);
CREATE INDEX idx_pl_blueprints_score ON public.playlist_blueprints(replication_score DESC);
CREATE UNIQUE INDEX idx_pl_blueprints_genre_slug ON public.playlist_blueprints(genre_id, slug);

ALTER TABLE public.playlist_blueprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_playlist_blueprints" ON public.playlist_blueprints
  FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_playlist_blueprints" ON public.playlist_blueprints
  FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_playlist_blueprints" ON public.playlist_blueprints
  FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_playlist_blueprints" ON public.playlist_blueprints
  FOR DELETE TO authenticated USING (public.has_team_access());

CREATE TRIGGER trg_pl_blueprints_updated_at
  BEFORE UPDATE ON public.playlist_blueprints
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================

CREATE TABLE public.playlist_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  blueprint_id UUID NOT NULL REFERENCES public.playlist_blueprints(id) ON DELETE CASCADE,
  genre_id UUID NOT NULL,
  variation_index INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT,
  cover_brief TEXT,
  track_seeds JSONB DEFAULT '[]'::jsonb,
  keywords JSONB DEFAULT '[]'::jsonb,
  regras JSONB DEFAULT '{}'::jsonb,
  replication_score NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | created
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  generated_by_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pl_templates_blueprint ON public.playlist_templates(blueprint_id);
CREATE INDEX idx_pl_templates_genre ON public.playlist_templates(genre_id);
CREATE INDEX idx_pl_templates_status ON public.playlist_templates(status);
CREATE INDEX idx_pl_templates_score ON public.playlist_templates(replication_score DESC);

ALTER TABLE public.playlist_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_playlist_templates" ON public.playlist_templates
  FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_playlist_templates" ON public.playlist_templates
  FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_playlist_templates" ON public.playlist_templates
  FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_playlist_templates" ON public.playlist_templates
  FOR DELETE TO authenticated USING (public.has_team_access());

CREATE TRIGGER trg_pl_templates_updated_at
  BEFORE UPDATE ON public.playlist_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();