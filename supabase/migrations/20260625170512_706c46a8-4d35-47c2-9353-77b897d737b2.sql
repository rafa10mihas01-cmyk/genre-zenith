
DROP FUNCTION IF EXISTS public.fn_process_occupancy_rebuild_queue(int);

CREATE FUNCTION public.fn_process_occupancy_rebuild_queue(p_limit int DEFAULT 20)
RETURNS TABLE(queue_id uuid, playlist_id uuid, result_status text, plan_id uuid, ops int, duration_ms int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record; v_plan uuid; v_ops int; v_started timestamptz; v_dur int; v_lock_key bigint;
BEGIN
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
      v_plan := public.fn_playlist_occupancy_rebuild(r.pl, 'SHADOW');
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
$$;

GRANT EXECUTE ON FUNCTION public.fn_process_occupancy_rebuild_queue(int) TO service_role;
