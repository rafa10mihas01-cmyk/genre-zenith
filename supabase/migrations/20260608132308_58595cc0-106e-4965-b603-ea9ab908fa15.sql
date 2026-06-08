
-- Fase 2.6 — Shadow tables for artist normalization (read-only validation)

CREATE TABLE IF NOT EXISTS public.artist_split_shadow (
  id BIGSERIAL PRIMARY KEY,
  source_table TEXT NOT NULL,           -- 'managed_playlist_tracks' | 'genre_reference_artists'
  source_id TEXT NOT NULL,              -- managed_playlist_tracks.id or genre_reference_artists.id
  original_combo TEXT NOT NULL,
  artist_individual TEXT NOT NULL,
  artist_norm TEXT NOT NULL,
  split_position INT NOT NULL,
  split_separator TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.artist_split_shadow TO authenticated;
GRANT ALL ON public.artist_split_shadow TO service_role;
ALTER TABLE public.artist_split_shadow ENABLE ROW LEVEL SECURITY;
CREATE POLICY "split_shadow_admin" ON public.artist_split_shadow FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_split_shadow_norm ON public.artist_split_shadow(artist_norm);
CREATE INDEX IF NOT EXISTS idx_split_shadow_source ON public.artist_split_shadow(source_table, source_id);

CREATE TABLE IF NOT EXISTS public.genre_reference_artists_shadow (
  id BIGSERIAL PRIMARY KEY,
  artist_norm TEXT NOT NULL,
  artist_display TEXT NOT NULL,
  genre_id UUID,
  genre_nome TEXT,
  occurrences INT NOT NULL DEFAULT 0,
  playlists_count INT NOT NULL DEFAULT 0,
  purity_pct NUMERIC(5,2),
  total_genre_appearances INT NOT NULL DEFAULT 0,
  is_anchor BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.genre_reference_artists_shadow TO authenticated;
GRANT ALL ON public.genre_reference_artists_shadow TO service_role;
ALTER TABLE public.genre_reference_artists_shadow ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ref_artists_shadow_admin" ON public.genre_reference_artists_shadow FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_ref_shadow_norm ON public.genre_reference_artists_shadow(artist_norm);
CREATE INDEX IF NOT EXISTS idx_ref_shadow_genre ON public.genre_reference_artists_shadow(genre_id);

CREATE TABLE IF NOT EXISTS public.artist_normalization_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  total_track_lines INT,
  combos_detected INT,
  unique_combos INT,
  unique_individuals INT,
  coverage_old_pct NUMERIC(5,2),
  coverage_new_pct NUMERIC(5,2),
  coverage_gain_pp NUMERIC(5,2),
  blind_genres_old INT,
  blind_genres_new INT,
  notes JSONB
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.artist_normalization_runs TO authenticated;
GRANT ALL ON public.artist_normalization_runs TO service_role;
ALTER TABLE public.artist_normalization_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "norm_runs_admin" ON public.artist_normalization_runs FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
