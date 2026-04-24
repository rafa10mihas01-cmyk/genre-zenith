-- Versão 2 do alvo diário por gênero: média ponderada por followers atuais
-- - score = SUM(class_score * followers) / SUM(followers), normalizado em [0..2]
-- - mix temporal: 3d (peso 0.6) + 7d (peso 0.4)
-- - decisão: >1.3 alta=max | <0.7 baixa=min | senão media=base | sem dados=base
-- - respeita rigorosamente max_daily (sem flexibilidade extra)

CREATE OR REPLACE FUNCTION public.get_genre_daily_target_v2(p_genre_id uuid)
RETURNS TABLE (
  min_daily        integer,
  base_daily       integer,
  max_daily        integer,
  performance_tier text,    -- 'alta' | 'media' | 'baixa' | 'sem_historico'
  score_3d         numeric, -- 0..2
  score_7d         numeric, -- 0..2
  final_score      numeric, -- 0..2
  evaluated_3d     integer,
  evaluated_7d     integer,
  target_today     integer,
  generated_today  integer,
  remaining        integer
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
  -- 1) defaults se não houver linha em genre_filters
  SELECT gf.min_daily, gf.base_daily, gf.max_daily
    INTO v_min, v_base, v_max
  FROM public.genre_filters gf
  WHERE gf.genre_id = p_genre_id;

  IF v_min IS NULL THEN
    v_min := 2; v_base := 4; v_max := 8;
  END IF;

  -- 2) último snapshot de followers por template (real, atualizado)
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
      -- média ponderada por followers; se soma de followers = 0, vira NULL e cai no fallback
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

  -- 3) mix temporal (resiliente quando uma janela é nula)
  IF v_score_3d IS NOT NULL AND v_score_7d IS NOT NULL THEN
    v_final := ROUND(v_score_3d * 0.6 + v_score_7d * 0.4, 4);
  ELSIF v_score_3d IS NOT NULL THEN
    v_final := ROUND(v_score_3d, 4);
  ELSIF v_score_7d IS NOT NULL THEN
    v_final := ROUND(v_score_7d, 4);
  ELSE
    v_final := NULL;
  END IF;

  -- 4) decisão (sem extrapolar max_daily)
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

  -- guarda extra: nunca abaixo do min, nunca acima do max
  v_target := LEAST(GREATEST(v_target, v_min), v_max);

  -- 5) contagem do dia em America/Sao_Paulo
  SELECT COUNT(*)::int
    INTO v_today
  FROM public.playlist_templates
  WHERE genre_id = p_genre_id
    AND status IN ('pending','approved','published')
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