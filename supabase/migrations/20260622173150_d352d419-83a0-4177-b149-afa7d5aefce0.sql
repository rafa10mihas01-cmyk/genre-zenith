
-- ============================================================
-- FASE 3 — Priorização do Engine (modo shadow)
-- ============================================================

-- 1) Tabela de scores (camada adicional, nunca substitui dados)
CREATE TABLE IF NOT EXISTS public.placement_priority_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id uuid NOT NULL REFERENCES public.catalog_placements(id) ON DELETE CASCADE,
  score numeric NOT NULL DEFAULT 0,
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.placement_priority_scores TO authenticated;
GRANT ALL ON public.placement_priority_scores TO service_role;

ALTER TABLE public.placement_priority_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages priority scores"
  ON public.placement_priority_scores
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can read priority scores"
  ON public.placement_priority_scores
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_priority_scores_placement
  ON public.placement_priority_scores(placement_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_priority_scores_calc_at
  ON public.placement_priority_scores(calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_priority_scores_run
  ON public.placement_priority_scores(run_id);
CREATE INDEX IF NOT EXISTS idx_priority_scores_score
  ON public.placement_priority_scores(score DESC);

-- 2) Tabela de runs (observabilidade)
CREATE TABLE IF NOT EXISTS public.engine_priority_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  duration_ms integer NULL,
  placements_evaluated integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  score_min numeric NULL,
  score_max numeric NULL,
  score_avg numeric NULL,
  score_p50 numeric NULL,
  score_p90 numeric NULL,
  components_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  triggered_by text NOT NULL DEFAULT 'cron',
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.engine_priority_runs TO authenticated;
GRANT ALL ON public.engine_priority_runs TO service_role;

ALTER TABLE public.engine_priority_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role manages priority runs"
  ON public.engine_priority_runs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can read priority runs"
  ON public.engine_priority_runs
  FOR SELECT TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_engine_priority_runs_started
  ON public.engine_priority_runs(started_at DESC);

-- 3) Função única de cálculo por placement
-- Componentes: spotify_popularity, campaign_boost, artist_score,
-- growth, release_age, diversity_penalty, learning_signal
CREATE OR REPLACE FUNCTION public.compute_placement_priority(_placement_id uuid)
RETURNS TABLE(score numeric, components jsonb, calculated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_track_id uuid;
  v_playlist_id uuid;
  v_spotify_track_id text;
  v_spotify_artist_id text;
  v_added_at timestamptz;
  v_pop numeric := 0;
  v_release_age_days integer := NULL;
  v_release_age numeric := 0;
  v_campaign_boost numeric := 0;
  v_growth numeric := 0;
  v_artist_score numeric := 0;
  v_diversity_penalty numeric := 0;
  v_learning numeric := 0;
  v_same_artist_count integer := 0;
  v_active_campaign boolean := false;
  v_score numeric := 0;
  v_components jsonb;
  v_now timestamptz := now();
BEGIN
  SELECT cp.catalog_track_id, cp.managed_playlist_id, cp.added_at,
         ct.spotify_track_id, ct.spotify_artist_id
    INTO v_track_id, v_playlist_id, v_added_at, v_spotify_track_id, v_spotify_artist_id
  FROM public.catalog_placements cp
  JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
  WHERE cp.id = _placement_id;

  IF v_track_id IS NULL THEN
    RETURN QUERY SELECT 0::numeric, jsonb_build_object('error','placement_not_found'), v_now;
    RETURN;
  END IF;

  -- spotify_popularity (0..100)
  SELECT COALESCE(stc.popularity, 0)
    INTO v_pop
  FROM public.spotify_track_cache stc
  WHERE stc.spotify_track_id = v_spotify_track_id
  LIMIT 1;
  v_pop := COALESCE(v_pop, 0);

  -- release_age (mais recente = mais bonus, decai em 365 dias)
  SELECT GREATEST(0, (v_now::date - stc.release_date))::int
    INTO v_release_age_days
  FROM public.spotify_track_cache stc
  WHERE stc.spotify_track_id = v_spotify_track_id
    AND stc.release_date IS NOT NULL
  LIMIT 1;

  IF v_release_age_days IS NOT NULL THEN
    v_release_age := GREATEST(0, 15 * (1 - LEAST(v_release_age_days, 365)::numeric / 365));
  END IF;

  -- campaign_boost: há campanha ativa apontando para este track?
  SELECT EXISTS(
    SELECT 1
    FROM public.curator_deal_songs cds
    JOIN public.curator_deals cd ON cd.id = cds.deal_id
    WHERE cds.catalog_track_id = v_track_id
      AND cd.status IN ('active','in_progress','approved','running')
      AND (cd.deadline IS NULL OR cd.deadline >= v_now::date)
  ) INTO v_active_campaign;

  IF v_active_campaign THEN
    v_campaign_boost := 15;
  END IF;

  -- growth: placement novo (<14 dias) recebe leve bônus
  IF v_added_at IS NOT NULL THEN
    v_growth := GREATEST(0, 10 * (1 - LEAST(EXTRACT(EPOCH FROM (v_now - v_added_at))/86400, 14)::numeric / 14));
  END IF;

  -- artist_score: placeholder normalizado por popularidade (fase 3, refinado depois)
  v_artist_score := LEAST(10, v_pop / 10.0);

  -- diversity_penalty: penaliza concentração do mesmo artista nesta playlist
  IF v_spotify_artist_id IS NOT NULL THEN
    SELECT COUNT(*)
      INTO v_same_artist_count
    FROM public.catalog_placements cp2
    JOIN public.catalog_tracks ct2 ON ct2.id = cp2.catalog_track_id
    WHERE cp2.managed_playlist_id = v_playlist_id
      AND cp2.status = 'active'
      AND ct2.spotify_artist_id = v_spotify_artist_id
      AND cp2.id <> _placement_id;

    IF v_same_artist_count > 1 THEN
      v_diversity_penalty := -1 * LEAST(20, (v_same_artist_count - 1) * 4);
    END IF;
  END IF;

  -- learning_signal: placeholder (fase futura preenche)
  v_learning := 0;

  v_score := v_pop
           + v_campaign_boost
           + v_growth
           + v_release_age
           + v_artist_score
           + v_diversity_penalty
           + v_learning;

  v_components := jsonb_build_object(
    'spotify_popularity', v_pop,
    'campaign_boost', v_campaign_boost,
    'campaign_active', v_active_campaign,
    'growth', round(v_growth::numeric, 2),
    'release_age_bonus', round(v_release_age::numeric, 2),
    'release_age_days', v_release_age_days,
    'artist_score', round(v_artist_score::numeric, 2),
    'diversity_penalty', v_diversity_penalty,
    'same_artist_count_in_playlist', v_same_artist_count,
    'learning_signal', v_learning
  );

  RETURN QUERY SELECT round(v_score::numeric, 2), v_components, v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_placement_priority(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_placement_priority(uuid) TO service_role, authenticated;

-- 4) Job de execução em massa (modo shadow)
CREATE OR REPLACE FUNCTION public.engine_priority_compute_all(_limit integer DEFAULT 5000)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_start timestamptz := clock_timestamp();
  v_evaluated integer := 0;
  v_errors integer := 0;
  v_score_min numeric;
  v_score_max numeric;
  v_score_avg numeric;
  v_score_p50 numeric;
  v_score_p90 numeric;
  r record;
  v_res record;
BEGIN
  INSERT INTO public.engine_priority_runs(triggered_by, components_used)
  VALUES ('cron', '["spotify_popularity","campaign_boost","growth","release_age_bonus","artist_score","diversity_penalty","learning_signal"]'::jsonb)
  RETURNING id INTO v_run_id;

  FOR r IN
    SELECT id FROM public.catalog_placements
    WHERE status = 'active'
    ORDER BY updated_at DESC NULLS LAST
    LIMIT _limit
  LOOP
    BEGIN
      SELECT * INTO v_res FROM public.compute_placement_priority(r.id);
      INSERT INTO public.placement_priority_scores(placement_id, score, components, calculated_at, run_id)
      VALUES (r.id, v_res.score, v_res.components, v_res.calculated_at, v_run_id);
      v_evaluated := v_evaluated + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;

  SELECT MIN(score), MAX(score), AVG(score),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY score),
         percentile_cont(0.9) WITHIN GROUP (ORDER BY score)
    INTO v_score_min, v_score_max, v_score_avg, v_score_p50, v_score_p90
  FROM public.placement_priority_scores
  WHERE run_id = v_run_id;

  UPDATE public.engine_priority_runs
     SET finished_at = clock_timestamp(),
         duration_ms = EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start))::int,
         placements_evaluated = v_evaluated,
         errors = v_errors,
         score_min = v_score_min,
         score_max = v_score_max,
         score_avg = v_score_avg,
         score_p50 = v_score_p50,
         score_p90 = v_score_p90
   WHERE id = v_run_id;

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.engine_priority_compute_all(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_priority_compute_all(integer) TO service_role;

-- 5) View de análise (passo 5): topo de scores recentes
CREATE OR REPLACE VIEW public.v_placement_priority_latest AS
SELECT DISTINCT ON (pps.placement_id)
  pps.placement_id,
  pps.score,
  pps.components,
  pps.calculated_at,
  cp.managed_playlist_id,
  cp.catalog_track_id,
  ct.track_name,
  ct.artist_name,
  ct.spotify_artist_id
FROM public.placement_priority_scores pps
JOIN public.catalog_placements cp ON cp.id = pps.placement_id
JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
ORDER BY pps.placement_id, pps.calculated_at DESC;

GRANT SELECT ON public.v_placement_priority_latest TO authenticated, service_role;

-- 6) Agendar execução horária via pg_cron (apenas se extensão existir)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('engine-priority-shadow-hourly')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'engine-priority-shadow-hourly');

    PERFORM cron.schedule(
      'engine-priority-shadow-hourly',
      '7 * * * *',
      $job$ SELECT public.engine_priority_compute_all(5000); $job$
    );
  END IF;
END
$cron$;
