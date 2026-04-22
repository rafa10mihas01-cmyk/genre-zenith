
CREATE TABLE IF NOT EXISTS public.playlist_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  spotify_playlist_id text,
  genre_id uuid,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'success',
  before jsonb NOT NULL DEFAULT '{}'::jsonb,
  after jsonb NOT NULL DEFAULT '{}'::jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  triggered_by text NOT NULL DEFAULT 'auto',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playlist_adjustments_template ON public.playlist_adjustments(template_id);
CREATE INDEX IF NOT EXISTS idx_playlist_adjustments_created ON public.playlist_adjustments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playlist_adjustments_genre ON public.playlist_adjustments(genre_id);

ALTER TABLE public.playlist_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_playlist_adjustments" ON public.playlist_adjustments
  FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_playlist_adjustments" ON public.playlist_adjustments
  FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_playlist_adjustments" ON public.playlist_adjustments
  FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_playlist_adjustments" ON public.playlist_adjustments
  FOR DELETE TO authenticated USING (public.has_team_access());

-- RPC: candidatos a auto-ajuste (baixa performance + idade > 48h + sem ajuste recente)
CREATE OR REPLACE FUNCTION public.get_low_performance_candidates(
  p_min_age_hours int DEFAULT 48,
  p_cooldown_hours int DEFAULT 72,
  p_limit int DEFAULT 5
)
RETURNS TABLE(
  template_id uuid,
  genre_id uuid,
  spotify_playlist_id text,
  spotify_url text,
  name text,
  performance_class text,
  created_on_spotify_at timestamptz,
  tempo_horas numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    t.id,
    t.genre_id,
    t.spotify_playlist_id,
    t.spotify_url,
    t.name,
    t.performance_class,
    t.created_on_spotify_at,
    ROUND(EXTRACT(EPOCH FROM (now() - t.created_on_spotify_at))/3600.0, 1) AS tempo_horas
  FROM public.playlist_templates t
  WHERE t.performance_class = 'baixa'
    AND t.spotify_playlist_id IS NOT NULL
    AND t.created_on_spotify_at IS NOT NULL
    AND t.created_on_spotify_at < now() - make_interval(hours => p_min_age_hours)
    AND NOT EXISTS (
      SELECT 1 FROM public.playlist_adjustments a
      WHERE a.template_id = t.id
        AND a.created_at > now() - make_interval(hours => p_cooldown_hours)
    )
  ORDER BY t.created_on_spotify_at ASC
  LIMIT GREATEST(p_limit, 1);
$$;
