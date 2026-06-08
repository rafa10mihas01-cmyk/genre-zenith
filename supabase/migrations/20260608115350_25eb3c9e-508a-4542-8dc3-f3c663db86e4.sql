CREATE TABLE IF NOT EXISTS public.dna_blind_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  reference_run_id uuid,
  target_genres text[] NOT NULL DEFAULT '{}',
  sample_per_genre int NOT NULL DEFAULT 50,
  totals jsonb,
  accuracy_pct numeric
);
GRANT SELECT ON public.dna_blind_test_runs TO authenticated;
GRANT ALL ON public.dna_blind_test_runs TO service_role;
ALTER TABLE public.dna_blind_test_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blind_runs_read_auth" ON public.dna_blind_test_runs FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.dna_blind_test_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.dna_blind_test_runs(id) ON DELETE CASCADE,
  playlist_id uuid NOT NULL,
  cadastrado_genre_name text,
  predicted_genre_id uuid,
  predicted_genre_name text,
  runner_up_genre_name text,
  confidence_pct numeric,
  margin_pct numeric,
  tracks_total int,
  artist_signals int,
  track_signals int,
  ambiguous_hits int,
  unclassifiable boolean DEFAULT false,
  unclassifiable_reason text,
  is_correct boolean,
  error_reasons text[] DEFAULT '{}',
  votes jsonb,
  supporting_artists jsonb,
  supporting_tracks jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dna_blind_test_playlists_run_idx ON public.dna_blind_test_playlists(run_id);
CREATE INDEX IF NOT EXISTS dna_blind_test_playlists_pl_idx ON public.dna_blind_test_playlists(playlist_id);
GRANT SELECT ON public.dna_blind_test_playlists TO authenticated;
GRANT ALL ON public.dna_blind_test_playlists TO service_role;
ALTER TABLE public.dna_blind_test_playlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blind_playlists_read_auth" ON public.dna_blind_test_playlists FOR SELECT TO authenticated USING (true);