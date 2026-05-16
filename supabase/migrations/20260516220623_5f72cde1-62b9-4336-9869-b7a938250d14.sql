
CREATE OR REPLACE FUNCTION public.tes_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TABLE IF NOT EXISTS public.track_ecosystem_score (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_track_id text NOT NULL UNIQUE,
  track_name text,
  artist_name text,
  streams_total bigint DEFAULT 0,
  streams_7d bigint DEFAULT 0,
  streams_28d bigint DEFAULT 0,
  growth_7d_pct numeric,
  growth_28d_pct numeric,
  acceleration numeric,
  managed_playlist_count integer DEFAULT 0,
  curator_playlist_count integer DEFAULT 0,
  total_playlist_count integer DEFAULT 0,
  deal_active_count integer DEFAULT 0,
  saturation_index numeric DEFAULT 0,
  frequency_score numeric DEFAULT 0,
  momentum_class text NOT NULL DEFAULT 'sem_dados',
  confidence numeric DEFAULT 0,
  snapshots_used integer DEFAULT 0,
  last_snapshot_at timestamptz,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tes_track_id ON public.track_ecosystem_score(spotify_track_id);
CREATE INDEX IF NOT EXISTS idx_tes_momentum ON public.track_ecosystem_score(momentum_class);
CREATE INDEX IF NOT EXISTS idx_tes_calculated_at ON public.track_ecosystem_score(calculated_at DESC);

ALTER TABLE public.track_ecosystem_score ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read ecosystem scores" ON public.track_ecosystem_score;
CREATE POLICY "Authenticated users can read ecosystem scores"
  ON public.track_ecosystem_score FOR SELECT
  TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_tes_updated_at ON public.track_ecosystem_score;
CREATE TRIGGER trg_tes_updated_at
  BEFORE UPDATE ON public.track_ecosystem_score
  FOR EACH ROW EXECUTE FUNCTION public.tes_set_updated_at();
