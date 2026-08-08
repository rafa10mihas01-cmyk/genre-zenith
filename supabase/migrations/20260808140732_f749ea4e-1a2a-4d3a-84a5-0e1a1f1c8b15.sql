DROP VIEW IF EXISTS public.v_placement_priority_latest;
DROP TABLE public.placement_priority_scores;
ALTER TABLE public.placement_priority_scores_new RENAME TO placement_priority_scores;
ALTER INDEX idx_pps_new_score RENAME TO idx_priority_scores_score;
ALTER INDEX idx_pps_new_calc_at RENAME TO idx_priority_scores_calc_at;

ALTER TABLE public.placement_priority_scores
  ADD CONSTRAINT placement_priority_scores_placement_id_fkey
  FOREIGN KEY (placement_id) REFERENCES public.catalog_placements(id) ON DELETE CASCADE;

CREATE VIEW public.v_placement_priority_latest
WITH (security_invoker = true) AS
SELECT pps.placement_id,
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
JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id;

GRANT SELECT ON public.v_placement_priority_latest TO authenticated;
GRANT SELECT ON public.v_placement_priority_latest TO service_role;

CREATE OR REPLACE FUNCTION public.engine_priority_compute_all(_limit integer DEFAULT 5000)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      VALUES (r.id, v_res.score, v_res.components, v_res.calculated_at, v_run_id)
      ON CONFLICT (placement_id) DO UPDATE
        SET score = EXCLUDED.score,
            components = EXCLUDED.components,
            calculated_at = EXCLUDED.calculated_at,
            run_id = EXCLUDED.run_id
        WHERE public.placement_priority_scores.score IS DISTINCT FROM EXCLUDED.score
           OR public.placement_priority_scores.components IS DISTINCT FROM EXCLUDED.components;
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
$function$;