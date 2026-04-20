-- Tabela de histórico de análises por gênero
CREATE TABLE public.genre_models_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  genre_id UUID NOT NULL,
  version INTEGER NOT NULL,
  run_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  -- Snapshot da análise (mesmo formato do genre_models)
  palavras_chave JSONB DEFAULT '[]'::jsonb,
  padroes_nome JSONB DEFAULT '[]'::jsonb,
  playlists_dominantes JSONB DEFAULT '[]'::jsonb,
  musicas_recorrentes JSONB DEFAULT '[]'::jsonb,
  insights JSONB DEFAULT '{}'::jsonb,

  -- Campos IA (preparados, nulos por enquanto)
  ai_summary TEXT,
  ai_insights TEXT,
  ai_suggestions JSONB,

  -- Métricas
  total_playlists INTEGER DEFAULT 0,
  total_enriched INTEGER DEFAULT 0,
  coverage_percent DOUBLE PRECISION DEFAULT 0,

  -- Diffs incrementais vs versão anterior
  diff_keywords JSONB DEFAULT '{}'::jsonb,
  diff_tracks JSONB DEFAULT '{}'::jsonb,
  diff_playlists JSONB DEFAULT '{}'::jsonb,

  CONSTRAINT genre_models_history_genre_version_unique UNIQUE (genre_id, version)
);

-- Índices úteis
CREATE INDEX idx_genre_models_history_genre_id ON public.genre_models_history(genre_id);
CREATE INDEX idx_genre_models_history_created_at ON public.genre_models_history(created_at DESC);
CREATE INDEX idx_genre_models_history_genre_version ON public.genre_models_history(genre_id, version DESC);

-- RLS: mesmas regras do genre_models
ALTER TABLE public.genre_models_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_genre_models_history"
ON public.genre_models_history FOR SELECT TO authenticated
USING (has_team_access());

CREATE POLICY "team_insert_genre_models_history"
ON public.genre_models_history FOR INSERT TO authenticated
WITH CHECK (has_team_access());

CREATE POLICY "team_update_genre_models_history"
ON public.genre_models_history FOR UPDATE TO authenticated
USING (has_team_access())
WITH CHECK (has_team_access());

CREATE POLICY "team_delete_genre_models_history"
ON public.genre_models_history FOR DELETE TO authenticated
USING (has_team_access());

-- Função para comparar quaisquer duas versões sob demanda
CREATE OR REPLACE FUNCTION public.compare_genre_versions(
  p_genre_id UUID,
  p_version_a INTEGER,
  p_version_b INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  va RECORD;
  vb RECORD;
  result JSONB;
BEGIN
  SELECT palavras_chave, musicas_recorrentes, playlists_dominantes
    INTO va
  FROM public.genre_models_history
  WHERE genre_id = p_genre_id AND version = p_version_a;

  SELECT palavras_chave, musicas_recorrentes, playlists_dominantes
    INTO vb
  FROM public.genre_models_history
  WHERE genre_id = p_genre_id AND version = p_version_b;

  IF va IS NULL OR vb IS NULL THEN
    RETURN jsonb_build_object('error', 'version not found');
  END IF;

  result := jsonb_build_object(
    'version_a', p_version_a,
    'version_b', p_version_b,
    'keywords_a', va.palavras_chave,
    'keywords_b', vb.palavras_chave,
    'tracks_a', va.musicas_recorrentes,
    'tracks_b', vb.musicas_recorrentes,
    'playlists_a', va.playlists_dominantes,
    'playlists_b', vb.playlists_dominantes
  );

  RETURN result;
END;
$$;