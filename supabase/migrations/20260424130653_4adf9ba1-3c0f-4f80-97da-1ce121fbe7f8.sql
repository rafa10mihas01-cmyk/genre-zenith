
-- ============================================================
-- FASE 1.3 — UPDATE atômico de accounts.current_playlists
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_account_playlists(p_spotify_user_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new integer;
BEGIN
  UPDATE public.accounts
     SET current_playlists = current_playlists + 1,
         updated_at = now()
   WHERE spotify_user_id = p_spotify_user_id
   RETURNING current_playlists INTO v_new;
  RETURN COALESCE(v_new, 0);
END;
$$;

-- ============================================================
-- FASE 1.2 — get_genre_daily_target_v2 conta 'created' (era 'published')
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_genre_daily_target_v2(p_genre_id uuid)
RETURNS TABLE(
  min_daily integer,
  base_daily integer,
  max_daily integer,
  performance_tier text,
  score_3d numeric,
  score_7d numeric,
  final_score numeric,
  evaluated_3d integer,
  evaluated_7d integer,
  target_today integer,
  generated_today integer,
  remaining integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min   integer;
  v_base  integer;
  v_max   integer;
  v_score_3d   numeric := NULL;
  v_score_7d   numeric := NULL;
  v_final      numeric := NULL;
  v_count_3d   integer := 0;
  v_count_7d   integer := 0;
  v_tier   text;
  v_target integer;
  v_today  integer := 0;
BEGIN
  SELECT gf.min_daily, gf.base_daily, gf.max_daily
    INTO v_min, v_base, v_max
  FROM public.genre_filters gf
  WHERE gf.genre_id = p_genre_id;

  IF v_min IS NULL THEN
    v_min := 2; v_base := 4; v_max := 8;
  END IF;

  WITH last_snap AS (
    SELECT DISTINCT ON (template_id)
      template_id,
      GREATEST(followers, 0) AS followers
    FROM public.playlist_metrics_snapshots
    ORDER BY template_id, collected_at DESC
  ),
  evaluated AS (
    SELECT
      t.id,
      t.performance_class,
      t.performance_evaluated_at,
      COALESCE(ls.followers, 0) AS followers
    FROM public.playlist_templates t
    LEFT JOIN last_snap ls ON ls.template_id = t.id
    WHERE t.genre_id = p_genre_id
      AND t.performance_evaluated_at IS NOT NULL
      AND t.performance_class IN ('alta','media','baixa')
  ),
  agg_3d AS (
    SELECT
      COUNT(*)::int AS n,
      CASE
        WHEN SUM(followers) > 0 THEN
          SUM(
            (CASE performance_class WHEN 'alta' THEN 2 WHEN 'media' THEN 1 ELSE 0 END)::numeric
            * followers::numeric
          ) / SUM(followers)::numeric
        ELSE NULL
      END AS score
    FROM evaluated
    WHERE performance_evaluated_at >= now() - interval '3 days'
  ),
  agg_7d AS (
    SELECT
      COUNT(*)::int AS n,
      CASE
        WHEN SUM(followers) > 0 THEN
          SUM(
            (CASE performance_class WHEN 'alta' THEN 2 WHEN 'media' THEN 1 ELSE 0 END)::numeric
            * followers::numeric
          ) / SUM(followers)::numeric
        ELSE NULL
      END AS score
    FROM evaluated
    WHERE performance_evaluated_at >= now() - interval '7 days'
  )
  SELECT a3.score, a7.score, a3.n, a7.n
    INTO v_score_3d, v_score_7d, v_count_3d, v_count_7d
  FROM agg_3d a3 CROSS JOIN agg_7d a7;

  IF v_score_3d IS NOT NULL AND v_score_7d IS NOT NULL THEN
    v_final := ROUND(v_score_3d * 0.6 + v_score_7d * 0.4, 4);
  ELSIF v_score_3d IS NOT NULL THEN
    v_final := ROUND(v_score_3d, 4);
  ELSIF v_score_7d IS NOT NULL THEN
    v_final := ROUND(v_score_7d, 4);
  ELSE
    v_final := NULL;
  END IF;

  IF v_final IS NULL THEN
    v_tier   := 'sem_historico';
    v_target := v_base;
  ELSIF v_final > 1.3 THEN
    v_tier   := 'alta';
    v_target := v_max;
  ELSIF v_final < 0.7 THEN
    v_tier   := 'baixa';
    v_target := v_min;
  ELSE
    v_tier   := 'media';
    v_target := v_base;
  END IF;

  v_target := LEAST(GREATEST(v_target, v_min), v_max);

  -- ✅ FIX: status real é 'created' (não 'published'); mantemos 'published' por compat se aparecer
  SELECT COUNT(*)::int
    INTO v_today
  FROM public.playlist_templates
  WHERE genre_id = p_genre_id
    AND status IN ('pending','approved','created','published')
    AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  RETURN QUERY SELECT
    v_min, v_base, v_max,
    v_tier,
    COALESCE(ROUND(v_score_3d, 4), 0),
    COALESCE(ROUND(v_score_7d, 4), 0),
    COALESCE(v_final, 0),
    v_count_3d, v_count_7d,
    v_target, v_today,
    GREATEST(v_target - v_today, 0);
END;
$$;

-- ============================================================
-- FASE 3.2 — Cleanup de runs travadas (>30min running)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_stale_autopilot_runs(p_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH stale AS (
    UPDATE public.autopilot_runs
       SET status = 'error',
           error_message = COALESCE(error_message, 'Run expirada — sem atualização há ' || p_minutes || ' min'),
           finished_at = now(),
           duracao_ms = EXTRACT(EPOCH FROM (now() - started_at))::int * 1000
     WHERE status = 'running'
       AND started_at < now() - make_interval(mins => p_minutes)
    RETURNING id
  )
  SELECT COUNT(*)::int INTO v_count FROM stale;
  RETURN v_count;
END;
$$;

-- ============================================================
-- FASE 4.2 — Constraints de status / enum textuais
-- ============================================================

-- limpar registros legados antes de aplicar (sem deletar dados, só validar)
-- Se algum legado violar, a constraint falha; nesse caso, ajustar manualmente.
DO $$
BEGIN
  -- status
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_playlist_templates_status'
  ) THEN
    ALTER TABLE public.playlist_templates
      ADD CONSTRAINT chk_playlist_templates_status
      CHECK (status IN ('pending','approved','created','published','rejected','archived'));
  END IF;

  -- performance_class
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_playlist_templates_perf_class'
  ) THEN
    ALTER TABLE public.playlist_templates
      ADD CONSTRAINT chk_playlist_templates_perf_class
      CHECK (performance_class IS NULL OR performance_class IN ('alta','media','baixa'));
  END IF;

  -- quality_tier (já existe trigger validate_template_tier, mas constraint é mais barata)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_playlist_templates_quality_tier'
  ) THEN
    ALTER TABLE public.playlist_templates
      ADD CONSTRAINT chk_playlist_templates_quality_tier
      CHECK (quality_tier IN ('hot','medium','weak','archived'));
  END IF;
END $$;

-- ============================================================
-- FASE 4.1 — Índices críticos
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_template_collected
  ON public.playlist_metrics_snapshots(template_id, collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_templates_genre_evaluated
  ON public.playlist_templates(genre_id, performance_evaluated_at)
  WHERE performance_evaluated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_templates_genre_status_created
  ON public.playlist_templates(genre_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_search_tracks_genre_track
  ON public.search_tracks(genre_id, spotify_track_id)
  WHERE spotify_track_id IS NOT NULL;
