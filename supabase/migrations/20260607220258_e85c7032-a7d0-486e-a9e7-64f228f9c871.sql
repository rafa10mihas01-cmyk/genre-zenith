-- ── Enriquecimento em playlist_dna ─────────────────────────────────────────
ALTER TABLE public.playlist_dna
  ADD COLUMN IF NOT EXISTS niche_top_artists jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS niche_top_tracks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS niche_top_subgenres jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS niche_adherence_score numeric,
  ADD COLUMN IF NOT EXISTS internal_concentration_score numeric,
  ADD COLUMN IF NOT EXISTS name_conflict jsonb,
  ADD COLUMN IF NOT EXISTS confidence_bucket text,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_playlist_dna_bucket ON public.playlist_dna(confidence_bucket);
CREATE INDEX IF NOT EXISTS idx_playlist_dna_niche_adherence ON public.playlist_dna(niche_adherence_score DESC);

-- ── Proposta de novas keywords por subgênero ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.playlist_dna_lexicon_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid,
  subgenre_id uuid REFERENCES public.subgenres(id) ON DELETE CASCADE,
  subgenre_name text,
  parent_genre_id uuid REFERENCES public.genres(id),
  parent_genre_name text,
  proposed_keyword text NOT NULL,
  frequency integer NOT NULL DEFAULT 0,
  distinct_playlists integer NOT NULL DEFAULT 0,
  already_existing boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dna_lex_proposals_run ON public.playlist_dna_lexicon_proposals(run_id);
CREATE INDEX IF NOT EXISTS idx_dna_lex_proposals_sub ON public.playlist_dna_lexicon_proposals(subgenre_id);
GRANT SELECT ON public.playlist_dna_lexicon_proposals TO authenticated;
GRANT ALL ON public.playlist_dna_lexicon_proposals TO service_role;
ALTER TABLE public.playlist_dna_lexicon_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lex_proposals_read_auth" ON public.playlist_dna_lexicon_proposals FOR SELECT TO authenticated USING (true);

-- ── Snapshot do run de enriquecimento ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.playlist_dna_quality_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total_playlists integer NOT NULL DEFAULT 0,
  total_classified integer NOT NULL DEFAULT 0,
  bucket_high integer NOT NULL DEFAULT 0,
  bucket_mid integer NOT NULL DEFAULT 0,
  bucket_low integer NOT NULL DEFAULT 0,
  confiavel integer NOT NULL DEFAULT 0,
  fraco integer NOT NULL DEFAULT 0,
  conflitos integer NOT NULL DEFAULT 0,
  insufficient_no_tracks integer NOT NULL DEFAULT 0,
  lexicon_keywords_current integer NOT NULL DEFAULT 0,
  lexicon_keywords_proposed integer NOT NULL DEFAULT 0,
  coverage_by_genre jsonb NOT NULL DEFAULT '{}'::jsonb,
  top_pure jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_hybrid jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_confused jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dna_quality_runs_started ON public.playlist_dna_quality_runs(started_at DESC);
GRANT SELECT ON public.playlist_dna_quality_runs TO authenticated;
GRANT ALL ON public.playlist_dna_quality_runs TO service_role;
ALTER TABLE public.playlist_dna_quality_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quality_runs_read_auth" ON public.playlist_dna_quality_runs FOR SELECT TO authenticated USING (true);