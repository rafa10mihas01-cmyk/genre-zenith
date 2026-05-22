
CREATE TABLE IF NOT EXISTS public.genre_seo_lexicon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subgenre_id uuid REFERENCES public.subgenres(id) ON DELETE CASCADE,
  genre_id uuid,
  token text NOT NULL,
  token_type text NOT NULL DEFAULT 'word',
  strength numeric NOT NULL DEFAULT 0,
  occurrences integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ativo',
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subgenre_id, token, token_type)
);
CREATE INDEX IF NOT EXISTS idx_lex_subgenre ON public.genre_seo_lexicon(subgenre_id, strength DESC);
CREATE INDEX IF NOT EXISTS idx_lex_status ON public.genre_seo_lexicon(status);

CREATE TABLE IF NOT EXISTS public.genre_visual_signature (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subgenre_id uuid NOT NULL REFERENCES public.subgenres(id) ON DELETE CASCADE,
  genre_id uuid,
  dominant_colors jsonb NOT NULL DEFAULT '[]'::jsonb,
  contrast_avg numeric,
  has_face_pct numeric,
  aggressiveness_score numeric,
  style_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_size integer NOT NULL DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subgenre_id)
);
CREATE INDEX IF NOT EXISTS idx_vsig_subgenre ON public.genre_visual_signature(subgenre_id);

ALTER TABLE public.genre_seo_lexicon ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genre_visual_signature ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage lexicon" ON public.genre_seo_lexicon
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated read lexicon" ON public.genre_seo_lexicon
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage visual signature" ON public.genre_visual_signature
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated read visual signature" ON public.genre_visual_signature
  FOR SELECT TO authenticated USING (true);
