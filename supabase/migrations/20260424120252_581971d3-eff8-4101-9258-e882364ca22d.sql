-- 1) Novas colunas em genre_filters (produção diária)
ALTER TABLE public.genre_filters
  ADD COLUMN IF NOT EXISTS min_daily  integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS base_daily integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS max_daily  integer NOT NULL DEFAULT 8;

-- Sanidade: min ≤ base ≤ max e todos > 0
ALTER TABLE public.genre_filters
  DROP CONSTRAINT IF EXISTS genre_filters_daily_bounds;
ALTER TABLE public.genre_filters
  ADD CONSTRAINT genre_filters_daily_bounds
  CHECK (min_daily > 0 AND base_daily >= min_daily AND max_daily >= base_daily);

-- 2) Função: calcula alvo diário dinâmico para um gênero
-- Janela de performance: 7d, apenas templates AVALIADOS (performance_evaluated_at not null)
-- Regras:
--   ≥50% performance_class='alta'  → max_daily
--   ≥40% performance_class='baixa' → min_daily
--   senão                          → base_daily
--   sem histórico avaliado         → base_daily
-- Contagem do dia: timezone America/Sao_Paulo, status IN (pending, approved, published)
CREATE OR REPLACE FUNCTION public.get_genre_daily_target(p_genre_id uuid)
RETURNS TABLE (
  min_daily       integer,
  base_daily      integer,
  max_daily       integer,
  performance_tier text,   -- 'alta' | 'media' | 'baixa' | 'sem_historico'
  evaluated_count  integer,
  pct_alta         numeric,
  pct_baixa        numeric,
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
  v_total integer := 0;
  v_alta  integer := 0;
  v_baixa integer := 0;
  v_pct_alta  numeric := 0;
  v_pct_baixa numeric := 0;
  v_tier  text;
  v_target integer;
  v_today_count integer := 0;
BEGIN
  -- defaults se não houver linha em genre_filters
  SELECT gf.min_daily, gf.base_daily, gf.max_daily
    INTO v_min, v_base, v_max
  FROM public.genre_filters gf
  WHERE gf.genre_id = p_genre_id;

  IF v_min IS NULL THEN
    v_min := 2; v_base := 4; v_max := 8;
  END IF;

  -- janela 7d de templates avaliados
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

  -- contagem do dia em America/Sao_Paulo
  SELECT COUNT(*)
    INTO v_today_count
  FROM public.playlist_templates
  WHERE genre_id = p_genre_id
    AND status IN ('pending', 'approved', 'published')
    AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date
        = (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  RETURN QUERY SELECT
    v_min, v_base, v_max,
    v_tier, v_total, v_pct_alta, v_pct_baixa,
    v_target, v_today_count,
    GREATEST(v_target - v_today_count, 0);
END;
$$;