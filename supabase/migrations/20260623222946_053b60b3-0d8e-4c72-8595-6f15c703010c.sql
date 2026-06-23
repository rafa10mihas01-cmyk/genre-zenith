CREATE OR REPLACE FUNCTION public.engine_run_distribution_wave(_limit integer DEFAULT NULL::integer)
 RETURNS TABLE(distributed integer, skipped integer, remaining integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_window constant int := 5;
  v_cron_min constant int := 10;
  v_cycles_per_day constant int := (24 * 60) / v_cron_min;
  v_cap_per_cycle constant int := 50;
  v_n_plans int;
  v_global_pending int;
  v_sum_days numeric;
  v_max_pending int;
  v_budget_day int;
  v_budget_cycle int;
  v_sum_urgency numeric;
  v_consumed int := 0;
  v_dist int := 0;
  v_skip int := 0;
  v_rem int := 0;
  v_safety int;
  rec record;
  trec record;
  v_local int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _wave_plans (
    plan_id uuid PRIMARY KEY,
    catalog_track_id uuid,
    urgency numeric,
    pending int,
    quota int DEFAULT 0
  ) ON COMMIT DROP;
  DELETE FROM _wave_plans WHERE true;

  WITH plans_active AS (
    SELECT p.id AS plan_id,
           p.catalog_track_id,
           p.started_at,
           COALESCE(p.priority,5) AS priority,
           p.total_eligible,
           p.total_distributed,
           GREATEST(0, EXTRACT(EPOCH FROM (v_now - p.started_at))/86400.0) AS age_days,
           s.pending,
           s.failed_24h
      FROM public.catalog_distribution_plans p
      JOIN public.catalog_tracks ct ON ct.id = p.catalog_track_id AND ct.status='active'
      JOIN LATERAL (
        SELECT
          SUM((status='pending')::int)::int AS pending,
          SUM((status IN ('skipped','failed') AND updated_at > v_now - interval '24 hours')::int)::int AS failed_24h
        FROM public.catalog_distribution_plan_targets
        WHERE plan_id = p.id
      ) s ON true
     WHERE p.status = 'active'
       AND COALESCE(s.pending,0) > 0
  ),
  agg AS (
    SELECT COUNT(*) AS n_plans,
           COALESCE(SUM(pending),0) AS sum_pending,
           COALESCE(SUM(GREATEST(1, v_window - age_days)),0) AS sum_days,
           COALESCE(MAX(pending),1) AS max_pending
      FROM plans_active
  )
  SELECT n_plans, sum_pending, sum_days, max_pending
    INTO v_n_plans, v_global_pending, v_sum_days, v_max_pending
    FROM agg;

  IF COALESCE(v_n_plans,0) = 0 OR COALESCE(v_global_pending,0) = 0 THEN
    SELECT GREATEST(0, COALESCE(SUM(total_eligible - total_distributed - total_skipped),0))::int
      INTO v_rem FROM public.catalog_distribution_plans WHERE status='active';
    RETURN QUERY SELECT 0, 0, GREATEST(0,v_rem); RETURN;
  END IF;

  v_budget_day := CEIL(v_global_pending::numeric / GREATEST(1.0, (v_sum_days / GREATEST(1,v_n_plans))));
  v_budget_cycle := LEAST(
    GREATEST(1, CEIL(v_budget_day::numeric / v_cycles_per_day)::int),
    v_cap_per_cycle
  );
  IF _limit IS NOT NULL THEN
    v_budget_cycle := LEAST(v_budget_cycle, GREATEST(1,_limit));
  END IF;

  INSERT INTO _wave_plans(plan_id, catalog_track_id, urgency, pending)
  SELECT pa.plan_id,
         pa.catalog_track_id,
         (
             40 * GREATEST(0, LEAST(1,
               ( (COALESCE(pa.total_eligible,0)::numeric * LEAST(v_window, pa.age_days) / v_window)
                 - COALESCE(pa.total_distributed,0)::numeric )
               / NULLIF(pa.total_eligible,0)
             ))
           + 20 * (pa.pending::numeric / GREATEST(1, v_max_pending))
           + 15 * (1 - COALESCE(pa.total_distributed,0)::numeric / NULLIF(pa.total_eligible,0))
           + 15 * (pa.priority::numeric / 10)
           + 10 * LEAST(1, COALESCE(pa.failed_24h,0)::numeric / 10)
         ) AS urgency,
         pa.pending
    FROM (
      SELECT p.id AS plan_id, p.catalog_track_id, p.started_at,
             COALESCE(p.priority,5) AS priority,
             p.total_eligible, p.total_distributed,
             GREATEST(0, EXTRACT(EPOCH FROM (v_now - p.started_at))/86400.0) AS age_days,
             s.pending, s.failed_24h
        FROM public.catalog_distribution_plans p
        JOIN public.catalog_tracks ct ON ct.id = p.catalog_track_id AND ct.status='active'
        JOIN LATERAL (
          SELECT SUM((status='pending')::int)::int AS pending,
                 SUM((status IN ('skipped','failed') AND updated_at > v_now - interval '24 hours')::int)::int AS failed_24h
            FROM public.catalog_distribution_plan_targets WHERE plan_id = p.id
        ) s ON true
       WHERE p.status='active' AND COALESCE(s.pending,0) > 0
    ) pa;

  SELECT COALESCE(SUM(urgency),0) INTO v_sum_urgency FROM _wave_plans;
  IF v_sum_urgency <= 0 THEN v_sum_urgency := 1; END IF;

  UPDATE _wave_plans
     SET quota = GREATEST(1, FLOOR(v_budget_cycle * urgency / v_sum_urgency)::int)
   WHERE true;

  FOR rec IN SELECT * FROM _wave_plans ORDER BY urgency DESC LOOP
    EXIT WHEN v_consumed >= v_budget_cycle;
    v_local := 0;
    FOR trec IN
      SELECT t.id AS target_id
        FROM public.catalog_distribution_plan_targets t
       WHERE t.plan_id = rec.plan_id AND t.status='pending'
       ORDER BY t.created_at
       LIMIT (rec.quota * 4)
    LOOP
      EXIT WHEN v_local >= rec.quota;
      EXIT WHEN v_consumed >= v_budget_cycle;
      IF public.engine_try_consume_target(trec.target_id, v_now) THEN
        v_local := v_local + 1;
        v_consumed := v_consumed + 1;
        v_dist := v_dist + 1;
      END IF;
    END LOOP;
  END LOOP;

  v_safety := v_budget_cycle * 3;
  WHILE v_consumed < v_budget_cycle AND v_safety > 0 LOOP
    v_safety := v_safety - 1;

    SELECT wp.plan_id INTO rec
      FROM _wave_plans wp
     WHERE EXISTS (
       SELECT 1 FROM public.catalog_distribution_plan_targets t
        WHERE t.plan_id = wp.plan_id AND t.status='pending'
     )
     ORDER BY wp.urgency DESC
     LIMIT 1;
    IF NOT FOUND THEN EXIT; END IF;

    DECLARE v_did boolean := false;
    BEGIN
      FOR trec IN
        SELECT t.id AS target_id
          FROM public.catalog_distribution_plan_targets t
         WHERE t.plan_id = rec.plan_id AND t.status='pending'
         ORDER BY t.created_at
         LIMIT 20
      LOOP
        IF public.engine_try_consume_target(trec.target_id, v_now) THEN
          v_consumed := v_consumed + 1;
          v_dist := v_dist + 1;
          v_did := true;
          EXIT;
        END IF;
      END LOOP;
      IF NOT v_did THEN EXIT; END IF;
    END;
  END LOOP;

  UPDATE public.catalog_distribution_plans p
     SET total_distributed = COALESCE(s.dist,0),
         total_skipped     = COALESCE(s.skip,0),
         next_wave_at      = v_now,
         updated_at        = v_now
    FROM (
      SELECT plan_id,
             SUM((status IN ('scheduled','processing','done','distributed'))::int) AS dist,
             SUM((status IN ('skipped','failed'))::int) AS skip
        FROM public.catalog_distribution_plan_targets
       GROUP BY plan_id
    ) s
   WHERE p.id = s.plan_id AND p.status='active';

  UPDATE public.catalog_distribution_plans p
     SET status='completed', completed_at=v_now, next_wave_at=NULL, updated_at=v_now
   WHERE p.status='active'
     AND p.total_eligible > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.catalog_distribution_plan_targets t
        WHERE t.plan_id = p.id AND t.status='pending'
     );

  SELECT COUNT(*)::int INTO v_skip
    FROM public.catalog_distribution_plan_targets
   WHERE updated_at >= v_now AND status IN ('skipped','failed');

  SELECT GREATEST(0, COALESCE(SUM(total_eligible - total_distributed - total_skipped),0))::int
    INTO v_rem FROM public.catalog_distribution_plans WHERE status='active';

  RETURN QUERY SELECT v_dist, v_skip, v_rem;
END $function$;