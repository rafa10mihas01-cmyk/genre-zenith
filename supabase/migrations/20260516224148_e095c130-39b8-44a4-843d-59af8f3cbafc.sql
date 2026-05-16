CREATE TABLE public.playlist_ecosystem_score (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_kind TEXT NOT NULL CHECK (playlist_kind IN ('curator','managed')),
  spotify_playlist_id TEXT NOT NULL,
  playlist_name TEXT,
  curator_name TEXT,
  image_url TEXT,
  followers BIGINT NOT NULL DEFAULT 0,
  track_count INTEGER NOT NULL DEFAULT 0,
  total_streams BIGINT NOT NULL DEFAULT 0,
  streams_7d BIGINT NOT NULL DEFAULT 0,
  streams_28d BIGINT NOT NULL DEFAULT 0,
  growth_28d_pct NUMERIC,
  avg_track_momentum NUMERIC,
  pct_subindo NUMERIC NOT NULL DEFAULT 0,
  pct_caindo NUMERIC NOT NULL DEFAULT 0,
  pct_saturada NUMERIC NOT NULL DEFAULT 0,
  pct_estavel NUMERIC NOT NULL DEFAULT 0,
  health_class TEXT NOT NULL DEFAULT 'sem_dados'
    CHECK (health_class IN ('aquecida','estavel','esfriando','saturada','subutilizada','sem_dados')),
  efficiency_score NUMERIC NOT NULL DEFAULT 0,
  confidence NUMERIC NOT NULL DEFAULT 0,
  snapshots_used INTEGER NOT NULL DEFAULT 0,
  last_snapshot_at TIMESTAMPTZ,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (playlist_kind, spotify_playlist_id)
);
CREATE INDEX idx_pes_health ON public.playlist_ecosystem_score(health_class);
CREATE INDEX idx_pes_calc ON public.playlist_ecosystem_score(calculated_at DESC);
CREATE INDEX idx_pes_spid ON public.playlist_ecosystem_score(spotify_playlist_id);
ALTER TABLE public.playlist_ecosystem_score ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read playlist scores"
ON public.playlist_ecosystem_score FOR SELECT TO authenticated USING (true);

CREATE TABLE public.track_playlist_fit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  spotify_track_id TEXT NOT NULL,
  spotify_playlist_id TEXT NOT NULL,
  playlist_kind TEXT NOT NULL CHECK (playlist_kind IN ('curator','managed')),
  fit_score INTEGER NOT NULL DEFAULT 0 CHECK (fit_score BETWEEN 0 AND 100),
  fit_reason TEXT[] NOT NULL DEFAULT '{}',
  recommendation_kind TEXT NOT NULL
    CHECK (recommendation_kind IN ('adicionar','remover','reorganizar','manter')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  already_present BOOLEAN NOT NULL DEFAULT false,
  confidence NUMERIC NOT NULL DEFAULT 0,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (spotify_track_id, spotify_playlist_id, playlist_kind)
);
CREATE INDEX idx_tpf_track ON public.track_playlist_fit(spotify_track_id);
CREATE INDEX idx_tpf_playlist ON public.track_playlist_fit(spotify_playlist_id);
CREATE INDEX idx_tpf_kind ON public.track_playlist_fit(recommendation_kind);
CREATE INDEX idx_tpf_score ON public.track_playlist_fit(fit_score DESC);
CREATE INDEX idx_tpf_calc ON public.track_playlist_fit(calculated_at DESC);
ALTER TABLE public.track_playlist_fit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read fits"
ON public.track_playlist_fit FOR SELECT TO authenticated USING (true);

CREATE TABLE public.recommendation_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  fit_id UUID NOT NULL REFERENCES public.track_playlist_fit(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('vista','descartada','util','inutil')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rf_fit ON public.recommendation_feedback(fit_id);
CREATE INDEX idx_rf_user ON public.recommendation_feedback(user_id);
ALTER TABLE public.recommendation_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own feedback"
ON public.recommendation_feedback FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own feedback"
ON public.recommendation_feedback FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own feedback"
ON public.recommendation_feedback FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own feedback"
ON public.recommendation_feedback FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at_w2()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_pes_updated BEFORE UPDATE ON public.playlist_ecosystem_score
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_w2();
CREATE TRIGGER trg_tpf_updated BEFORE UPDATE ON public.track_playlist_fit
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_w2();