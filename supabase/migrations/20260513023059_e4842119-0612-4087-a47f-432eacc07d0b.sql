
-- Tabela principal: 1 linha por playlist (estado atual do cérebro)
CREATE TABLE public.playlist_brain (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_id uuid NOT NULL UNIQUE REFERENCES public.playlists(id) ON DELETE CASCADE,

  -- Identidade (gerada pela análise)
  identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- ex: { nicho, sub_nicho, mood, idioma, energia, era_dominante }

  -- Personalidade (comportamento da playlist)
  personality jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- ex: { freq_update_dias, ritmo_troca_pct, pct_evergreen, total_tracks, pct_brasileiras }

  -- Capacidade operacional
  capacity_total integer,           -- plays/dia agregados estimados
  capacity_per_slot integer,        -- plays médios por nova música (NULL até ter snapshots suficientes)
  capacity_ceiling integer,         -- teto teórico (NULL até Fase 2 - concorrentes)
  headroom_pct numeric(5,2),        -- (ceiling - total) / ceiling * 100

  -- Saúde e tendência
  health_trend text NOT NULL DEFAULT 'novo' CHECK (health_trend IN ('crescendo','estavel','encolhendo','novo','sem_dados')),

  -- Sinais ativos (problemas/oportunidades detectados)
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- ex: [{ code: 'sem_snapshot', severity: 'high', detected_at, message }]

  -- Recomendações priorizadas
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- ex: [{ priority: 1, action: 'aquecer', reason, impact_estimate }]

  -- Confiança nos cálculos (sobe quando mais dados disponíveis)
  confidence_score smallint NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),

  -- Metadados de cálculo
  last_calculated_at timestamptz NOT NULL DEFAULT now(),
  calculation_version smallint NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_playlist_brain_playlist ON public.playlist_brain(playlist_id);
CREATE INDEX idx_playlist_brain_calculated ON public.playlist_brain(last_calculated_at DESC);
CREATE INDEX idx_playlist_brain_trend ON public.playlist_brain(health_trend);
CREATE INDEX idx_playlist_brain_signals ON public.playlist_brain USING GIN(signals);

-- RLS
ALTER TABLE public.playlist_brain ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_playlist_brain" ON public.playlist_brain
  FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_playlist_brain" ON public.playlist_brain
  FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_playlist_brain" ON public.playlist_brain
  FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_playlist_brain" ON public.playlist_brain
  FOR DELETE TO authenticated USING (has_team_access());

CREATE TRIGGER trg_playlist_brain_updated
  BEFORE UPDATE ON public.playlist_brain
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Tabela leve de histórico (1 linha por cálculo, só pra trend)
CREATE TABLE public.playlist_brain_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  playlist_id uuid NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  capacity_total integer,
  capacity_per_slot integer,
  health_score smallint,        -- snapshot do playlist_scores.health_score no momento
  signals_count smallint NOT NULL DEFAULT 0,
  confidence_score smallint NOT NULL DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pbh_playlist_calc ON public.playlist_brain_history(playlist_id, calculated_at DESC);

ALTER TABLE public.playlist_brain_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_pbh" ON public.playlist_brain_history
  FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_pbh" ON public.playlist_brain_history
  FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_delete_pbh" ON public.playlist_brain_history
  FOR DELETE TO authenticated USING (has_team_access());
