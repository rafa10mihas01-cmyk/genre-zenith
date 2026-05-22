CREATE TABLE public.editorial_history (
  id          BIGSERIAL PRIMARY KEY,
  genre_id    TEXT NOT NULL,
  track_id    TEXT NOT NULL,
  run_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  position    INT,
  score_final NUMERIC(6,2),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_editorial_history_genre_date
  ON public.editorial_history(genre_id, run_date DESC);

ALTER TABLE public.editorial_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view editorial history"
  ON public.editorial_history
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
