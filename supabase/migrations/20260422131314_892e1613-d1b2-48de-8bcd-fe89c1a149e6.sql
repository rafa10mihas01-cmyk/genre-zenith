
-- Snapshots de métricas das playlists publicadas (coletadas via Spotify API)
CREATE TABLE public.playlist_metrics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  spotify_playlist_id text NOT NULL,
  followers integer NOT NULL DEFAULT 0,
  total_tracks integer,
  collected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pms_template ON public.playlist_metrics_snapshots(template_id, collected_at DESC);
CREATE INDEX idx_pms_spotify ON public.playlist_metrics_snapshots(spotify_playlist_id, collected_at DESC);

ALTER TABLE public.playlist_metrics_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_select_pms" ON public.playlist_metrics_snapshots FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_pms" ON public.playlist_metrics_snapshots FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_pms" ON public.playlist_metrics_snapshots FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_pms" ON public.playlist_metrics_snapshots FOR DELETE TO authenticated USING (has_team_access());

-- Insights de performance gerados pelo Claude (interpretação)
CREATE TABLE public.performance_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid,
  scope text NOT NULL DEFAULT 'global',
  total_playlists_analisadas integer NOT NULL DEFAULT 0,
  insights jsonb NOT NULL DEFAULT '{}'::jsonb,
  recomendacoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  acoes_sugeridas jsonb NOT NULL DEFAULT '[]'::jsonb,
  classificacao jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by_model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pi_genre ON public.performance_insights(genre_id, created_at DESC);
CREATE INDEX idx_pi_scope ON public.performance_insights(scope, created_at DESC);

ALTER TABLE public.performance_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_select_pi" ON public.performance_insights FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_pi" ON public.performance_insights FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_pi" ON public.performance_insights FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_pi" ON public.performance_insights FOR DELETE TO authenticated USING (has_team_access());

-- Acrescenta colunas para baseline na própria template (snapshot inicial)
ALTER TABLE public.playlist_templates
  ADD COLUMN IF NOT EXISTS followers_at_creation integer,
  ADD COLUMN IF NOT EXISTS performance_class text,
  ADD COLUMN IF NOT EXISTS performance_evaluated_at timestamptz;

-- Função: pega métricas agregadas por template para alimentar o Claude
CREATE OR REPLACE FUNCTION public.get_performance_dataset(p_min_age_hours int DEFAULT 24)
RETURNS TABLE(
  template_id uuid,
  genre_id uuid,
  nome text,
  spotify_playlist_id text,
  spotify_url text,
  followers_start integer,
  followers_now integer,
  crescimento_absoluto integer,
  crescimento_percentual numeric,
  tempo_horas numeric,
  total_tracks integer,
  created_on_spotify_at timestamptz,
  last_snapshot_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH last_snap AS (
    SELECT DISTINCT ON (template_id)
      template_id, followers, total_tracks, collected_at
    FROM public.playlist_metrics_snapshots
    ORDER BY template_id, collected_at DESC
  )
  SELECT
    t.id,
    t.genre_id,
    t.name,
    t.spotify_playlist_id,
    t.spotify_url,
    COALESCE(t.followers_at_creation, 0)::int AS followers_start,
    COALESCE(ls.followers, 0)::int AS followers_now,
    (COALESCE(ls.followers,0) - COALESCE(t.followers_at_creation,0))::int AS crescimento_absoluto,
    CASE WHEN COALESCE(t.followers_at_creation,0) > 0
         THEN ROUND(((COALESCE(ls.followers,0) - t.followers_at_creation)::numeric / t.followers_at_creation::numeric) * 100, 2)
         ELSE NULL END AS crescimento_percentual,
    CASE WHEN t.created_on_spotify_at IS NOT NULL
         THEN ROUND(EXTRACT(EPOCH FROM (now() - t.created_on_spotify_at))/3600.0, 1)
         ELSE NULL END AS tempo_horas,
    COALESCE(ls.total_tracks, t.tracks_added)::int AS total_tracks,
    t.created_on_spotify_at,
    ls.collected_at
  FROM public.playlist_templates t
  LEFT JOIN last_snap ls ON ls.template_id = t.id
  WHERE t.spotify_playlist_id IS NOT NULL
    AND t.created_on_spotify_at IS NOT NULL
    AND t.created_on_spotify_at < now() - make_interval(hours => p_min_age_hours)
  ORDER BY t.created_on_spotify_at DESC;
$$;
