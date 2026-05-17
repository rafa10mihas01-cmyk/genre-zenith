
CREATE TABLE IF NOT EXISTS public.learning_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid REFERENCES public.genres(id) ON DELETE CASCADE,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'wave4-learn-from-winners',
  winners_count int NOT NULL DEFAULT 0,
  min_winner_score int,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  artists jsonb NOT NULL DEFAULT '[]'::jsonb,
  tracks jsonb NOT NULL DEFAULT '[]'::jsonb,
  insights jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_learning_snapshots_genre_at
  ON public.learning_snapshots (genre_id, snapshot_at DESC);

ALTER TABLE public.learning_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_learning_snapshots" ON public.learning_snapshots
  FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_learning_snapshots" ON public.learning_snapshots
  FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_learning_snapshots" ON public.learning_snapshots
  FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_learning_snapshots" ON public.learning_snapshots
  FOR DELETE TO authenticated USING (has_team_access());
