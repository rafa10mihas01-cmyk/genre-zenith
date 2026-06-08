-- Phase 2.1: Shadow DNA tables for comparative reclassification.
-- Mirrors playlist_dna and playlist_dna_runs but stores results computed with
-- an EXPANDED lexicon (current subgenres.palavras_chave + playlist_dna_lexicon_proposals).
-- Read-only experiment: production playlist_dna is never overwritten.

CREATE TABLE IF NOT EXISTS public.playlist_dna_shadow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  playlist_id uuid NOT NULL,
  dominant_genre_id uuid,
  dominant_genre_name text,
  dominant_genre_pct numeric,
  dominant_subgenre_id uuid,
  dominant_subgenre_name text,
  dominant_subgenre_pct numeric,
  genre_distribution jsonb DEFAULT '{}'::jsonb,
  subgenre_distribution jsonb DEFAULT '{}'::jsonb,
  top_artists jsonb DEFAULT '[]'::jsonb,
  unique_artists_count integer DEFAULT 0,
  tracks_analyzed integer DEFAULT 0,
  tracks_matched integer DEFAULT 0,
  avg_track_age_days numeric,
  median_track_age_days numeric,
  purity_score numeric,
  classification text,
  classification_confidence numeric,
  confidence_bucket text,
  classification_reasons jsonb DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, playlist_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_dna_shadow_run ON public.playlist_dna_shadow(run_id);
CREATE INDEX IF NOT EXISTS idx_playlist_dna_shadow_playlist ON public.playlist_dna_shadow(playlist_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.playlist_dna_shadow TO authenticated;
GRANT ALL ON public.playlist_dna_shadow TO service_role;
ALTER TABLE public.playlist_dna_shadow ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shadow_dna_admin_only" ON public.playlist_dna_shadow
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.playlist_dna_shadow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  scope text DEFAULT 'all',
  lexicon_source text DEFAULT 'expanded',
  proposals_applied integer DEFAULT 0,
  total_candidates integer DEFAULT 0,
  processed integer DEFAULT 0,
  insufficient integer DEFAULT 0,
  nicho integer DEFAULT 0,
  tematica integer DEFAULT 0,
  tendencia integer DEFAULT 0,
  hibrida integer DEFAULT 0,
  failed integer DEFAULT 0,
  notes jsonb DEFAULT '{}'::jsonb
);

GRANT SELECT, INSERT, UPDATE ON public.playlist_dna_shadow_runs TO authenticated;
GRANT ALL ON public.playlist_dna_shadow_runs TO service_role;
ALTER TABLE public.playlist_dna_shadow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shadow_dna_runs_admin_only" ON public.playlist_dna_shadow_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));