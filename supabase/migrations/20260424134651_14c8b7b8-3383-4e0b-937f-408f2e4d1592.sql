-- ============================================================
-- FASE A.1 — Limpar constraints duplicadas em playlist_templates
-- ============================================================
-- Remove as 3 constraints antigas (perdiam efeito por permitirem 'published')
ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS playlist_templates_status_check;
ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS playlist_templates_performance_class_check;
ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS playlist_templates_quality_tier_check;

-- Reescreve a chk_status removendo 'published' (string morta)
ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS chk_playlist_templates_status;
ALTER TABLE public.playlist_templates
  ADD CONSTRAINT chk_playlist_templates_status
  CHECK (status IN ('pending','approved','created','archived','rejected'));

-- ============================================================
-- FASE B.1 — get_genre_daily_target (v1) usando status canônico
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_genre_daily_target(p_genre_id uuid)
 RETURNS TABLE(min_daily integer, base_daily integer, max_daily integer, performance_tier text, evaluated_count integer, pct_alta numeric, pct_baixa numeric, target_today integer, generated_today integer, remaining integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_min   integer;
  v_base  integer;
  v_max   integer;
  v_total integer := 0;
  v_alta  integer := 0;
  v_baixa integer := 0;
  v_pct_alta  numeric := 0;
  v_pct_baixa numeric := 0;
  v_tier  text;
  v_target integer;
  v_today_count integer := 0;
BEGIN
  SELECT gf.min_daily, gf.base_daily, gf.max_daily
    INTO v_min, v_base, v_max
  FROM public.genre_filters gf
  WHERE gf.genre_id = p_genre_id;

  IF v_min IS NULL THEN
    v_min := 2; v_base := 4; v_max := 8;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE performance_evaluated_at IS NOT NULL),
    COUNT(*) FILTER (WHERE performance_evaluated_at IS NOT NULL AND performance_class = 'alta'),
    COUNT(*) FILTER (WHERE performance_evaluated_at IS NOT NULL AND performance_class = 'baixa')
  INTO v_total, v_alta, v_baixa
  FROM public.playlist_templates
  WHERE genre_id = p_genre_id
    AND performance_evaluated_at >= now() - interval '7 days';

  IF v_total = 0 THEN
    v_tier := 'sem_historico';
    v_target := v_base;
  ELSE
    v_pct_alta  := ROUND((v_alta::numeric  / v_total::numeric) * 100, 2);
    v_pct_baixa := ROUND((v_baixa::numeric / v_total::numeric) * 100, 2);
    IF v_pct_alta >= 50 THEN
      v_tier := 'alta'; v_target := v_max;
    ELSIF v_pct_baixa >= 40 THEN
      v_tier := 'baixa'; v_target := v_min;
    ELSE
      v_tier := 'media'; v_target := v_base;
    END IF;
  END IF;

  -- ✅ FIX: status canônico (sem 'published')
  SELECT COUNT(*)
    INTO v_today_count
  FROM public.playlist_templates
  WHERE genre_id = p_genre_id
    AND status IN ('pending','approved','created')
    AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  RETURN QUERY SELECT
    v_min, v_base, v_max,
    v_tier, v_total, v_pct_alta, v_pct_baixa,
    v_target, v_today_count,
    GREATEST(v_target - v_today_count, 0);
END;
$function$;

-- Atualiza v2 também (estava aceitando 'published' por compat)
CREATE OR REPLACE FUNCTION public.get_genre_daily_target_v2(p_genre_id uuid)
 RETURNS TABLE(min_daily integer, base_daily integer, max_daily integer, performance_tier text, score_3d numeric, score_7d numeric, final_score numeric, evaluated_3d integer, evaluated_7d integer, target_today integer, generated_today integer, remaining integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      template_id, GREATEST(followers, 0) AS followers
    FROM public.playlist_metrics_snapshots
    ORDER BY template_id, collected_at DESC
  ),
  evaluated AS (
    SELECT t.id, t.performance_class, t.performance_evaluated_at,
           COALESCE(ls.followers, 0) AS followers
    FROM public.playlist_templates t
    LEFT JOIN last_snap ls ON ls.template_id = t.id
    WHERE t.genre_id = p_genre_id
      AND t.performance_evaluated_at IS NOT NULL
      AND t.performance_class IN ('alta','media','baixa')
  ),
  agg_3d AS (
    SELECT COUNT(*)::int AS n,
      CASE WHEN SUM(followers) > 0 THEN
        SUM((CASE performance_class WHEN 'alta' THEN 2 WHEN 'media' THEN 1 ELSE 0 END)::numeric * followers::numeric)
        / SUM(followers)::numeric
      ELSE NULL END AS score
    FROM evaluated
    WHERE performance_evaluated_at >= now() - interval '3 days'
  ),
  agg_7d AS (
    SELECT COUNT(*)::int AS n,
      CASE WHEN SUM(followers) > 0 THEN
        SUM((CASE performance_class WHEN 'alta' THEN 2 WHEN 'media' THEN 1 ELSE 0 END)::numeric * followers::numeric)
        / SUM(followers)::numeric
      ELSE NULL END AS score
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
  END IF;

  IF v_final IS NULL THEN
    v_tier := 'sem_historico'; v_target := v_base;
  ELSIF v_final > 1.3 THEN
    v_tier := 'alta'; v_target := v_max;
  ELSIF v_final < 0.7 THEN
    v_tier := 'baixa'; v_target := v_min;
  ELSE
    v_tier := 'media'; v_target := v_base;
  END IF;

  v_target := LEAST(GREATEST(v_target, v_min), v_max);

  -- ✅ FIX: status canônico (sem 'published')
  SELECT COUNT(*)::int
    INTO v_today
  FROM public.playlist_templates
  WHERE genre_id = p_genre_id
    AND status IN ('pending','approved','created')
    AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  RETURN QUERY SELECT
    v_min, v_base, v_max, v_tier,
    COALESCE(ROUND(v_score_3d, 4), 0),
    COALESCE(ROUND(v_score_7d, 4), 0),
    COALESCE(v_final, 0),
    v_count_3d, v_count_7d,
    v_target, v_today,
    GREATEST(v_target - v_today, 0);
END;
$function$;

-- ============================================================
-- FASE B.2 — priority_from_performance trata NULL como sem histórico
-- ============================================================
CREATE OR REPLACE FUNCTION public.priority_from_performance(p_class text)
 RETURNS TABLE(priority text, reason text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN p_class IS NULL THEN 'baixa'
      WHEN p_class = 'alta' THEN 'alta'
      WHEN p_class = 'baixa' THEN 'baixa'
      ELSE 'media'
    END AS priority,
    CASE
      WHEN p_class IS NULL THEN 'sem histórico de performance — não replicar até avaliar'
      WHEN p_class = 'alta'  THEN 'padrão vencedor — replicar com prioridade'
      WHEN p_class = 'media' THEN 'desempenho médio — replicar com cautela'
      WHEN p_class = 'baixa' THEN 'baixo desempenho — marcar para ajuste ou pausa'
      ELSE 'classe desconhecida'
    END AS reason;
$function$;

-- ============================================================
-- FASE B.3 — Remover policy duplicada em storage
-- ============================================================
DROP POLICY IF EXISTS playlist_covers_team_write ON storage.objects;