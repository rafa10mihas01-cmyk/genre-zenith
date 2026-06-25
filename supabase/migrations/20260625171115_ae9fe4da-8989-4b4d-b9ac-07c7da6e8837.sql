
-- 1. Flag de modo do engine
ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS occupancy_engine_mode text NOT NULL DEFAULT 'shadow'
    CHECK (occupancy_engine_mode IN ('shadow','dual_write','primary'));

-- 2. Colunas de execução nos planos
ALTER TABLE public.occupancy_plans
  ADD COLUMN IF NOT EXISTS executor_status text NOT NULL DEFAULT 'pending'
    CHECK (executor_status IN ('pending','running','executed','partial','failed','skipped')),
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS executor_stats jsonb,
  ADD COLUMN IF NOT EXISTS spotify_snapshot_id text,
  ADD COLUMN IF NOT EXISTS executor_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS executor_error text;

CREATE INDEX IF NOT EXISTS idx_occupancy_plans_exec
  ON public.occupancy_plans(mode, status, executor_status)
  WHERE status = 'ready';

-- 3. Colunas de execução nas ops
ALTER TABLE public.occupancy_plan_ops
  ADD COLUMN IF NOT EXISTS op_status text NOT NULL DEFAULT 'pending'
    CHECK (op_status IN ('pending','done','error','skipped')),
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

-- 4. Permite modo DUAL_WRITE no rebuild
CREATE OR REPLACE FUNCTION public.fn_playlist_occupancy_rebuild(p_playlist_id uuid, p_mode text DEFAULT 'SHADOW'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id uuid;
  v_policy record;
  v_policy_src text;
  v_total_current integer := 0;
  v_third_count integer := 0;
  v_third_cap integer := 0;
  v_campaign_count integer := 0;
  v_dup_removed integer := 0;
  v_third_overflow integer := 0;
  v_inserts integer := 0;
  v_repos integer := 0;
BEGIN
  IF p_mode NOT IN ('SHADOW','DUAL_WRITE','PRIMARY') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode;
  END IF;

  SELECT * INTO v_policy FROM public.fn_resolve_playlist_policy(p_playlist_id);
  IF v_policy IS NULL OR v_policy.managed_playlist_id IS NULL THEN
    RAISE EXCEPTION 'playlist % não encontrada', p_playlist_id;
  END IF;
  v_policy_src := v_policy.source;

  INSERT INTO public.occupancy_plans (managed_playlist_id, mode, status, policy_snapshot)
  VALUES (
    p_playlist_id, p_mode,
    CASE WHEN v_policy_src = 'missing' THEN 'blocked' ELSE 'draft' END,
    to_jsonb(v_policy)
  ) RETURNING id INTO v_plan_id;

  IF v_policy_src = 'missing' THEN
    UPDATE public.occupancy_plans SET block_reason='policy_missing', finalized_at=now() WHERE id=v_plan_id;
    INSERT INTO public.playlist_policy_alerts (managed_playlist_id, alert_type, severity, message, details)
    VALUES (p_playlist_id, 'policy_missing', 'warning',
            'Playlist sem política editorial; rebalanceamento bloqueado.',
            jsonb_build_object('plan_id', v_plan_id));
    RETURN v_plan_id;
  END IF;

  DROP TABLE IF EXISTS _cur;
  CREATE TEMP TABLE _cur ON COMMIT DROP AS
  SELECT
    mpt.spotify_track_id,
    mpt.position,
    COALESCE(o.origin, 'ThirdParty') AS origin,
    ROW_NUMBER() OVER (PARTITION BY mpt.spotify_track_id ORDER BY mpt.position NULLS LAST) AS dup_rank
  FROM public.managed_playlist_tracks mpt
  LEFT JOIN public.v_playlist_track_origin o
    ON o.managed_playlist_id = mpt.playlist_id
   AND o.spotify_track_id   = mpt.spotify_track_id
  WHERE mpt.playlist_id = p_playlist_id;

  SELECT count(*) INTO v_total_current FROM _cur;
  SELECT count(*) INTO v_campaign_count FROM _cur WHERE origin='Campaign' AND dup_rank=1;
  SELECT count(*) INTO v_third_count FROM _cur WHERE origin='ThirdParty' AND dup_rank=1;
  v_third_cap := floor(GREATEST(v_total_current,1) * v_policy.third_party_max_pct / 100.0);

  -- OP1: dedupe
  INSERT INTO public.occupancy_plan_ops (plan_id, op_type, spotify_track_id, classification, from_position, reason)
  SELECT v_plan_id, 'REMOVE', spotify_track_id, origin, position, 'dedupe_intra_playlist'
  FROM _cur WHERE dup_rank > 1;
  GET DIAGNOSTICS v_dup_removed = ROW_COUNT;

  -- OP2: REPOSITION para proteger top-N (Campaign)
  INSERT INTO public.occupancy_plan_ops (plan_id, op_type, spotify_track_id, classification, from_position, to_position, reason)
  SELECT v_plan_id, 'REPOSITION', cb.spotify_track_id, 'Campaign', cb.position, nc.position, 'protect_top_n_campaign'
  FROM (
    SELECT spotify_track_id, position, ROW_NUMBER() OVER (ORDER BY position) rn
      FROM _cur WHERE dup_rank=1 AND origin='Campaign' AND position > v_policy.protect_top_n
  ) cb
  JOIN (
    SELECT position, ROW_NUMBER() OVER (ORDER BY position) rn
      FROM _cur WHERE dup_rank=1 AND origin <> 'Campaign' AND position <= v_policy.protect_top_n
  ) nc ON nc.rn = cb.rn;
  GET DIAGNOSTICS v_repos = ROW_COUNT;

  -- OP3: INSERT catálogo nos slots livres
  IF v_total_current < (v_policy.campaign_reserved_slots + v_policy.catalog_capacity) THEN
    WITH livres AS (
      SELECT (v_policy.campaign_reserved_slots + v_policy.catalog_capacity) - v_total_current AS qtd
    ),
    candidatos AS (
      SELECT ct.spotify_track_id
        FROM public.catalog_placements cp
        JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
       WHERE cp.managed_playlist_id = p_playlist_id
         AND cp.status = 'active'
         AND ct.spotify_track_id NOT IN (SELECT spotify_track_id FROM _cur WHERE dup_rank=1)
       LIMIT (SELECT qtd FROM livres)
    )
    INSERT INTO public.occupancy_plan_ops (plan_id, op_type, spotify_track_id, classification, to_position, reason)
    SELECT v_plan_id, 'INSERT', spotify_track_id, 'Catalog',
           v_total_current + ROW_NUMBER() OVER (), 'fill_free_slot'
    FROM candidatos;
    GET DIAGNOSTICS v_inserts = ROW_COUNT;
  END IF;

  -- OP4: REMOVE excedente de terceiros (gradual - E3)
  IF v_third_count > v_third_cap THEN
    v_third_overflow := v_third_count - v_third_cap;
    INSERT INTO public.occupancy_plan_ops (plan_id, op_type, spotify_track_id, classification, from_position, reason)
    SELECT v_plan_id, 'REMOVE', spotify_track_id, 'ThirdParty', position, 'third_party_overflow_gradual'
    FROM (
      SELECT spotify_track_id, position FROM _cur
      WHERE dup_rank=1 AND origin='ThirdParty'
      ORDER BY position DESC
      LIMIT GREATEST(1, ceil(v_third_overflow::numeric / 4.0)::int)
    ) z;
  END IF;

  UPDATE public.occupancy_plans
     SET status='ready', finalized_at=now(),
         stats = jsonb_build_object(
           'total_current', v_total_current,
           'campaign_count', v_campaign_count,
           'third_party_count', v_third_count,
           'third_party_cap', v_third_cap,
           'third_party_overflow', v_third_overflow,
           'duplicates_removed', v_dup_removed,
           'campaign_repositions', v_repos,
           'catalog_inserts', v_inserts
         )
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END;
$function$;

-- 5. Worker passa modo lido da flag (SHADOW por padrão, DUAL_WRITE quando ativado).
CREATE OR REPLACE FUNCTION public.fn_process_occupancy_rebuild_queue(p_limit integer DEFAULT 20)
 RETURNS TABLE(queue_id uuid, playlist_id uuid, result_status text, plan_id uuid, ops integer, duration_ms integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_plan uuid; v_ops int; v_started timestamptz; v_dur int; v_lock_key bigint;
  v_flag text; v_mode text;
BEGIN
  SELECT occupancy_engine_mode INTO v_flag FROM public.system_flags LIMIT 1;
  v_mode := CASE upper(COALESCE(v_flag,'shadow'))
              WHEN 'DUAL_WRITE' THEN 'DUAL_WRITE'
              WHEN 'PRIMARY'    THEN 'PRIMARY'
              ELSE 'SHADOW'
            END;

  FOR r IN
    SELECT q.id AS qid, q.managed_playlist_id AS pl, q.trigger_source AS src
      FROM public.occupancy_rebuild_queue q
     WHERE q.status = 'pending'
     ORDER BY q.enqueued_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    v_lock_key := ('x' || substr(md5(r.pl::text),1,16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
      UPDATE public.occupancy_rebuild_queue
         SET status='skipped_lock', finished_at=now(), last_error='lock_busy'
       WHERE id = r.qid;
      queue_id := r.qid; playlist_id := r.pl; result_status := 'skipped_lock';
      plan_id := NULL; ops := 0; duration_ms := 0;
      RETURN NEXT; CONTINUE;
    END IF;

    UPDATE public.occupancy_rebuild_queue
       SET status='processing', started_at=now(), attempts=attempts+1
     WHERE id = r.qid;
    v_started := clock_timestamp();

    BEGIN
      v_plan := public.fn_playlist_occupancy_rebuild(r.pl, v_mode);
      v_dur  := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_started))::int;
      SELECT count(*)::int INTO v_ops FROM public.occupancy_plan_ops o WHERE o.plan_id = v_plan;
      UPDATE public.occupancy_plans p
         SET trigger_source = r.src,
             started_at     = v_started,
             duration_ms    = v_dur,
             ops_count      = COALESCE(v_ops,0),
             finalized_at   = COALESCE(p.finalized_at, now())
       WHERE p.id = v_plan;
      UPDATE public.occupancy_rebuild_queue
         SET status = CASE WHEN COALESCE(v_ops,0)=0 THEN 'no_change' ELSE 'done' END,
             plan_id = v_plan, finished_at = now()
       WHERE id = r.qid;
      queue_id := r.qid; playlist_id := r.pl;
      result_status := CASE WHEN COALESCE(v_ops,0)=0 THEN 'no_change' ELSE 'done' END;
      plan_id := v_plan; ops := COALESCE(v_ops,0); duration_ms := v_dur;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      v_dur := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_started))::int;
      UPDATE public.occupancy_rebuild_queue
         SET status='error', last_error=SQLERRM, finished_at=now()
       WHERE id = r.qid;
      queue_id := r.qid; playlist_id := r.pl; result_status := 'error';
      plan_id := NULL; ops := 0; duration_ms := v_dur;
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$;

-- 6. RPC para o executor reservar planos prontos em DUAL_WRITE/PRIMARY (lock por playlist via advisory)
CREATE OR REPLACE FUNCTION public.fn_occupancy_claim_executable_plans(p_limit integer DEFAULT 10)
 RETURNS TABLE(plan_id uuid, managed_playlist_id uuid, mode text, ops_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_lock_key bigint; v_flag text;
BEGIN
  SELECT occupancy_engine_mode INTO v_flag FROM public.system_flags LIMIT 1;
  IF lower(COALESCE(v_flag,'shadow')) NOT IN ('dual_write','primary') THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT p.id, p.managed_playlist_id, p.mode, p.ops_count
      FROM public.occupancy_plans p
     WHERE p.status = 'ready'
       AND p.mode IN ('DUAL_WRITE','PRIMARY')
       AND p.executor_status = 'pending'
       AND COALESCE(p.ops_count,0) > 0
     ORDER BY p.finalized_at NULLS LAST
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    v_lock_key := ('x' || substr(md5(r.managed_playlist_id::text),1,16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
      CONTINUE;
    END IF;
    UPDATE public.occupancy_plans
       SET executor_status = 'running',
           executor_attempts = executor_attempts + 1
     WHERE id = r.id;
    plan_id := r.id;
    managed_playlist_id := r.managed_playlist_id;
    mode := r.mode;
    ops_count := r.ops_count;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- 7. View de métricas do executor
CREATE OR REPLACE VIEW public.v_occupancy_executor_metrics AS
SELECT
  date_trunc('hour', COALESCE(executed_at, finalized_at)) AS bucket,
  mode,
  executor_status,
  count(*)            AS plans,
  COALESCE(sum(ops_count),0) AS ops_total,
  avg(duration_ms)::int       AS avg_rebuild_ms,
  count(*) FILTER (WHERE executor_status='executed') AS executed,
  count(*) FILTER (WHERE executor_status='partial')  AS partial,
  count(*) FILTER (WHERE executor_status='failed')   AS failed
FROM public.occupancy_plans
WHERE finalized_at >= now() - interval '7 days'
GROUP BY 1,2,3
ORDER BY 1 DESC;

GRANT SELECT ON public.v_occupancy_executor_metrics TO authenticated, service_role;
