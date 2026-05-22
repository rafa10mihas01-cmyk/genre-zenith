CREATE TABLE IF NOT EXISTS public.genre_brain (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid NOT NULL UNIQUE REFERENCES public.genres(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  parent_genre_id uuid REFERENCES public.genres(id) ON DELETE SET NULL,

  top_tokens jsonb NOT NULL DEFAULT '[]'::jsonb,
  tokens_total integer NOT NULL DEFAULT 0,
  tokens_strong integer NOT NULL DEFAULT 0,
  lexicon_updated_at timestamptz,

  dominant_colors jsonb NOT NULL DEFAULT '[]'::jsonb,
  style_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  aggressiveness_score numeric,
  has_face_pct numeric,
  contrast_avg numeric,
  aesthetics_updated_at timestamptz,

  playlists_total integer NOT NULL DEFAULT 0,
  playlists_with_genre integer NOT NULL DEFAULT 0,
  active_leaders integer NOT NULL DEFAULT 0,
  avg_leadership_score numeric,
  leadership_updated_at timestamptz,

  avg_confidence numeric,
  recent_drifts_7d integer NOT NULL DEFAULT 0,
  recent_reclassifications_7d integer NOT NULL DEFAULT 0,
  knowledge_score numeric,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_recomputed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_genre_brain_genre ON public.genre_brain(genre_id);
CREATE INDEX IF NOT EXISTS idx_genre_brain_knowledge ON public.genre_brain(knowledge_score DESC NULLS LAST);

ALTER TABLE public.genre_brain ENABLE ROW LEVEL SECURITY;

CREATE POLICY "genre_brain_read_auth"
  ON public.genre_brain FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "genre_brain_admin_write"
  ON public.genre_brain FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_genre_brain_updated_at
  BEFORE UPDATE ON public.genre_brain
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();