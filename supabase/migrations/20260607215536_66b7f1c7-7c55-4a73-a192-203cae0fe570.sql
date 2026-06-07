-- DNA por playlist (uma linha por managed_playlists.id)
CREATE TABLE IF NOT EXISTS public.playlist_dna (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL UNIQUE REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  dominant_genre_id uuid REFERENCES public.genres(id),
  dominant_genre_name text,
  dominant_genre_pct numeric,
  dominant_subgenre_id uuid REFERENCES public.subgenres(id),
  dominant_subgenre_name text,
  dominant_subgenre_pct numeric,
  genre_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  subgenre_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  top_artists jsonb NOT NULL DEFAULT '[]'::jsonb,
  unique_artists_count integer NOT NULL DEFAULT 0,
  tracks_analyzed integer NOT NULL DEFAULT 0,
  tracks_matched integer NOT NULL DEFAULT 0,
  avg_track_age_days numeric,
  median_track_age_days numeric,
  purity_score numeric,
  classification text CHECK (classification IN ('Nicho','Tematica','Tendencia','Hibrida','Insuficiente')),
  classification_confidence numeric,
  classification_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playlist_dna_classification ON public.playlist_dna(classification);
CREATE INDEX IF NOT EXISTS idx_playlist_dna_dominant_genre ON public.playlist_dna(dominant_genre_id);
CREATE INDEX IF NOT EXISTS idx_playlist_dna_computed_at ON public.playlist_dna(computed_at DESC);

GRANT SELECT ON public.playlist_dna TO authenticated;
GRANT ALL ON public.playlist_dna TO service_role;

ALTER TABLE public.playlist_dna ENABLE ROW LEVEL SECURITY;
CREATE POLICY "playlist_dna_read_auth" ON public.playlist_dna FOR SELECT TO authenticated USING (true);

-- Auditoria de cada execução do classificador
CREATE TABLE IF NOT EXISTS public.playlist_dna_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  scope text NOT NULL DEFAULT 'all',
  total_candidates integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  insufficient integer NOT NULL DEFAULT 0,
  nicho integer NOT NULL DEFAULT 0,
  tematica integer NOT NULL DEFAULT 0,
  tendencia integer NOT NULL DEFAULT 0,
  hibrida integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playlist_dna_runs_started ON public.playlist_dna_runs(started_at DESC);

GRANT SELECT ON public.playlist_dna_runs TO authenticated;
GRANT ALL ON public.playlist_dna_runs TO service_role;

ALTER TABLE public.playlist_dna_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "playlist_dna_runs_read_auth" ON public.playlist_dna_runs FOR SELECT TO authenticated USING (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_playlist_dna()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_playlist_dna ON public.playlist_dna;
CREATE TRIGGER trg_touch_playlist_dna BEFORE UPDATE ON public.playlist_dna
FOR EACH ROW EXECUTE FUNCTION public.touch_playlist_dna();