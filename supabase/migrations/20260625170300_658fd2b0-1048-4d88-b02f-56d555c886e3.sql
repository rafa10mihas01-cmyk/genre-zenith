
-- =========================================================
-- FASE 4 — Orquestração e Gatilhos (SHADOW)
-- =========================================================

-- 1) Observabilidade no plano
ALTER TABLE public.occupancy_plans
  ADD COLUMN IF NOT EXISTS trigger_source text,
  ADD COLUMN IF NOT EXISTS started_at    timestamptz,
  ADD COLUMN IF NOT EXISTS duration_ms   integer,
  ADD COLUMN IF NOT EXISTS ops_count     integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_occ_plans_trigger_created
  ON public.occupancy_plans(trigger_source, created_at DESC);

-- 2) Fila de rebuilds
CREATE TABLE IF NOT EXISTS public.occupancy_rebuild_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  managed_playlist_id uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  trigger_source text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','error','skipped_lock','no_change')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  plan_id uuid REFERENCES public.occupancy_plans(id) ON DELETE SET NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

GRANT SELECT ON public.occupancy_rebuild_queue TO authenticated;
GRANT ALL    ON public.occupancy_rebuild_queue TO service_role;

ALTER TABLE public.occupancy_rebuild_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read occupancy queue"
  ON public.occupancy_rebuild_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages occupancy queue"
  ON public.occupancy_rebuild_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 1 pendência ativa por playlist
CREATE UNIQUE INDEX IF NOT EXISTS uq_occ_queue_pending_one_per_pl
  ON public.occupancy_rebuild_queue(managed_playlist_id)
  WHERE status IN ('pending','processing');

CREATE INDEX IF NOT EXISTS idx_occ_queue_status_enq
  ON public.occupancy_rebuild_queue(status, enqueued_at);

-- 3) Helper de enfileiramento (dedupe via partial unique)
CREATE OR REPLACE FUNCTION public.fn_enqueue_occupancy_rebuild(
  p_playlist_id uuid,
  p_trigger_source text,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_playlist_id IS NULL THEN RETURN NULL; END IF;
  BEGIN
    INSERT INTO public.occupancy_rebuild_queue(managed_playlist_id, trigger_source, payload)
    VALUES (p_playlist_id, p_trigger_source, COALESCE(p_payload,'{}'::jsonb))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.occupancy_rebuild_queue
     WHERE managed_playlist_id = p_playlist_id AND status IN ('pending','processing')
     LIMIT 1;
  END;
  RETURN v_id;
END;
$$;

-- 4) Worker: processa a fila com lock por playlist
CREATE OR REPLACE FUNCTION public.fn_process_occupancy_rebuild_queue(
  p_limit int DEFAULT 20
) RETURNS TABLE(queue_id uuid, playlist_id uuid, status text, plan_id uuid, ops int, duration_ms int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_plan uuid;
  v_ops int;
  v_started timestamptz;
  v_dur int;
  v_lock_key bigint;
BEGIN
  FOR r IN
    SELECT id, managed_playlist_id, trigger_source
      FROM public.occupancy_rebuild_queue
     WHERE status = 'pending'
     ORDER BY enqueued_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    v_lock_key := ('x' || substr(md5(r.managed_playlist_id::text),1,16))::bit(64)::bigint;
    IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
      UPDATE public.occupancy_rebuild_queue
         SET status='skipped_lock', finished_at=now(), last_error='lock_busy'
       WHERE id = r.id;
      queue_id := r.id; playlist_id := r.managed_playlist_id; status := 'skipped_lock';
      plan_id := NULL; ops := 0; duration_ms := 0;
      RETURN NEXT; CONTINUE;
    END IF;

    UPDATE public.occupancy_rebuild_queue
       SET status='processing', started_at=now(), attempts=attempts+1
     WHERE id=r.id;
    v_started := clock_timestamp();

    BEGIN
      v_plan := public.fn_playlist_occupancy_rebuild(r.managed_playlist_id, 'SHADOW');
      v_dur := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_started))::int;
      SELECT count(*)::int INTO v_ops FROM public.occupancy_plan_ops WHERE plan_id = v_plan;
      UPDATE public.occupancy_plans
         SET trigger_source = r.trigger_source,
             started_at    = v_started,
             duration_ms   = v_dur,
             ops_count     = COALESCE(v_ops,0),
             finalized_at  = COALESCE(finalized_at, now())
       WHERE id = v_plan;
      UPDATE public.occupancy_rebuild_queue
         SET status = CASE WHEN COALESCE(v_ops,0)=0 THEN 'no_change' ELSE 'done' END,
             plan_id = v_plan, finished_at = now()
       WHERE id = r.id;
      queue_id := r.id; playlist_id := r.managed_playlist_id;
      status := CASE WHEN COALESCE(v_ops,0)=0 THEN 'no_change' ELSE 'done' END;
      plan_id := v_plan; ops := COALESCE(v_ops,0); duration_ms := v_dur;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      v_dur := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_started))::int;
      UPDATE public.occupancy_rebuild_queue
         SET status='error', last_error=SQLERRM, finished_at=now()
       WHERE id = r.id;
      queue_id := r.id; playlist_id := r.managed_playlist_id; status := 'error';
      plan_id := NULL; ops := 0; duration_ms := v_dur;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_enqueue_occupancy_rebuild(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_process_occupancy_rebuild_queue(int) TO service_role;

-- =========================================================
-- 5) Triggers — eventos obrigatórios
-- =========================================================

-- 5.1) managed_playlist_tracks: sync, inclusões, remoções, alterações manuais
CREATE OR REPLACE FUNCTION public.trg_occ_mpt_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_enqueue_occupancy_rebuild(playlist_id, 'managed_tracks_insert', '{}'::jsonb)
      FROM (SELECT DISTINCT playlist_id FROM new_rows) s;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.fn_enqueue_occupancy_rebuild(playlist_id, 'managed_tracks_delete', '{}'::jsonb)
      FROM (SELECT DISTINCT playlist_id FROM old_rows) s;
  ELSE
    PERFORM public.fn_enqueue_occupancy_rebuild(playlist_id, 'managed_tracks_update', '{}'::jsonb)
      FROM (SELECT DISTINCT playlist_id FROM new_rows) s;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_occ_mpt_ai ON public.managed_playlist_tracks;
DROP TRIGGER IF EXISTS trg_occ_mpt_ad ON public.managed_playlist_tracks;
DROP TRIGGER IF EXISTS trg_occ_mpt_au ON public.managed_playlist_tracks;

CREATE TRIGGER trg_occ_mpt_ai AFTER INSERT ON public.managed_playlist_tracks
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_occ_mpt_changed();

CREATE TRIGGER trg_occ_mpt_ad AFTER DELETE ON public.managed_playlist_tracks
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_occ_mpt_changed();

CREATE TRIGGER trg_occ_mpt_au AFTER UPDATE ON public.managed_playlist_tracks
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_occ_mpt_changed();

-- 5.2) catalog_placements: inclusão / remoção de catálogo (cobre status active/removed)
CREATE OR REPLACE FUNCTION public.trg_occ_catalog_placement_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_pl uuid; v_src text;
BEGIN
  v_pl := COALESCE(NEW.managed_playlist_id, OLD.managed_playlist_id);
  IF TG_OP='INSERT' THEN v_src := 'catalog_placement_insert';
  ELSIF TG_OP='DELETE' THEN v_src := 'catalog_placement_delete';
  ELSE v_src := 'catalog_placement_update'; END IF;
  PERFORM public.fn_enqueue_occupancy_rebuild(v_pl, v_src, '{}'::jsonb);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_occ_cp_aiud ON public.catalog_placements;
CREATE TRIGGER trg_occ_cp_aiud
AFTER INSERT OR UPDATE OF status OR DELETE ON public.catalog_placements
FOR EACH ROW EXECUTE FUNCTION public.trg_occ_catalog_placement_changed();

-- 5.3) campaigns: criação e encerramento
CREATE OR REPLACE FUNCTION public.trg_occ_campaign_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_track text; v_src text;
BEGIN
  v_track := COALESCE(NEW.spotify_track_id, OLD.spotify_track_id);
  IF v_track IS NULL THEN RETURN NULL; END IF;

  IF TG_OP='INSERT' THEN v_src := 'campaign_created';
  ELSIF TG_OP='UPDATE' AND COALESCE(NEW.status,'') <> COALESCE(OLD.status,'')
        AND NEW.status IN ('closed','completed','cancelled','archived') THEN
    v_src := 'campaign_closed';
  ELSIF TG_OP='UPDATE' AND COALESCE(NEW.status,'') <> COALESCE(OLD.status,'')
        AND NEW.status IN ('active','running','approved') THEN
    v_src := 'campaign_activated';
  ELSE
    RETURN NULL;
  END IF;

  -- Enfileira rebuild para toda playlist gerenciada que já contém a faixa da campanha
  PERFORM public.fn_enqueue_occupancy_rebuild(mpt.playlist_id, v_src,
    jsonb_build_object('campaign_id', COALESCE(NEW.id, OLD.id), 'track', v_track))
  FROM (SELECT DISTINCT playlist_id FROM public.managed_playlist_tracks
        WHERE spotify_track_id = v_track) mpt;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_occ_campaign_lc ON public.campaigns;
CREATE TRIGGER trg_occ_campaign_lc
AFTER INSERT OR UPDATE OF status ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION public.trg_occ_campaign_lifecycle();

-- 5.4) playlist_editorial_policies: alteração de política
CREATE OR REPLACE FUNCTION public.trg_occ_policy_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_pl uuid;
BEGIN
  v_pl := COALESCE(NEW.managed_playlist_id, OLD.managed_playlist_id);
  PERFORM public.fn_enqueue_occupancy_rebuild(v_pl, 'policy_changed', '{}'::jsonb);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_occ_policy_aiud ON public.playlist_editorial_policies;
CREATE TRIGGER trg_occ_policy_aiud
AFTER INSERT OR UPDATE OR DELETE ON public.playlist_editorial_policies
FOR EACH ROW EXECUTE FUNCTION public.trg_occ_policy_changed();

-- =========================================================
-- 6) View de métricas
-- =========================================================
CREATE OR REPLACE VIEW public.v_occupancy_rebuild_metrics AS
SELECT
  date_trunc('hour', enqueued_at)                                 AS bucket,
  trigger_source,
  count(*)                                                        AS total,
  count(*) FILTER (WHERE status='done')                           AS executed,
  count(*) FILTER (WHERE status='no_change')                      AS no_change,
  count(*) FILTER (WHERE status='skipped_lock')                   AS blocked,
  count(*) FILTER (WHERE status='error')                          AS errors,
  count(*) FILTER (WHERE status='pending')                        AS pending,
  count(*) FILTER (WHERE status='processing')                     AS processing,
  ROUND(AVG(EXTRACT(EPOCH FROM (finished_at-started_at))*1000)
        FILTER (WHERE finished_at IS NOT NULL AND started_at IS NOT NULL))::int AS avg_ms
FROM public.occupancy_rebuild_queue
WHERE enqueued_at > now() - interval '7 days'
GROUP BY 1,2
ORDER BY 1 DESC, 2;

GRANT SELECT ON public.v_occupancy_rebuild_metrics TO authenticated, service_role;
