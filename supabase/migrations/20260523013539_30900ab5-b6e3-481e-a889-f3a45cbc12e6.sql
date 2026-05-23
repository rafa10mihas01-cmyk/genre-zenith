CREATE TABLE IF NOT EXISTS public.genre_affinities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_a_id  uuid NOT NULL REFERENCES public.genres(id) ON DELETE CASCADE,
  genre_b_id  uuid NOT NULL REFERENCES public.genres(id) ON DELETE CASCADE,
  score       numeric(4,3) NOT NULL CHECK (score >= 0 AND score <= 1),
  method      text NOT NULL CHECK (method IN ('lexicon','manual','hybrid')),
  lexicon_score numeric(4,3),
  manual_score  numeric(4,3),
  shared_tokens jsonb DEFAULT '[]'::jsonb,
  notes       text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT genre_affinities_ordered CHECK (genre_a_id < genre_b_id),
  CONSTRAINT genre_affinities_unique UNIQUE (genre_a_id, genre_b_id)
);

CREATE INDEX IF NOT EXISTS idx_genre_affinities_a ON public.genre_affinities(genre_a_id);
CREATE INDEX IF NOT EXISTS idx_genre_affinities_b ON public.genre_affinities(genre_b_id);
CREATE INDEX IF NOT EXISTS idx_genre_affinities_score ON public.genre_affinities(score DESC);

ALTER TABLE public.genre_affinities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "genre_affinities readable by authenticated"
  ON public.genre_affinities FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER trg_genre_affinities_touch_updated_at
  BEFORE UPDATE ON public.genre_affinities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();