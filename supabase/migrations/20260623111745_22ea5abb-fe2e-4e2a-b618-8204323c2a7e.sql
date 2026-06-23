
-- =========================================================================
-- ENGINE NATURAL — Scheduler capacity-based (urgency + global budget)
-- =========================================================================
-- Reescreve a Distribuição Natural:
--   * 100% das playlists elegíveis viram targets na criação do plano
--   * 1ª onda imediata após o cadastro
--   * orçamento global por ciclo dividido por urgency_score entre planos ativos
--   * sobras redistribuídas no mesmo ciclo
--   * sem cap 90, sem fallback bulk, sem seleção parcial
--   * worker process-catalog-placements permanece intacto
-- =========================================================================

-- 1) Schema: priority no plano + CHECK robusto no status do target -----------
ALTER TABLE public.catalog_distribution_plans
  ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 5;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='chk_cdpt_status'
      AND conrelid='public.catalog_distribution_plan_targets'::regclass
  ) THEN
    ALTER TABLE public.catalog_distribution_plan_targets DROP CONSTRAINT chk_cdpt_status;
  END IF;
END $$;

ALTER TABLE public.catalog_distribution_plan_targets
  ADD CONSTRAINT chk_cdpt_status CHECK (
    status IN ('pending','scheduled','processing','done','skipped','failed','distributed')
  );

-- 2) Backups _v1 (rollback) -------------------------------------------------
CREATE OR REPLACE FUNCTION public.distribute_catalog_track_v1(
  p_spotify_track_id text, p_genre_id uuid,
  p_spotify_uri text DEFAULT NULL, p_isrc text DEFAULT NULL,
  p_track_name text DEFAULT NULL, p_artist_name text DEFAULT NULL,
  p_cover_url text DEFAULT NULL, p_baseline_popularity integer DEFAULT NULL,
  p_baseline_monthly_listeners bigint DEFAULT NULL, p_baseline_streams bigint DEFAULT NULL,
  p_baseline_raw jsonb DEFAULT NULL, p_added_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('legacy_v1', true); $$;

CREATE OR REPLACE FUNCTION public.engine_create_distribution_plan_v1(_track_id uuid, _days smallint DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid; $$;

CREATE OR REPLACE FUNCTION public.engine_run_distribution_wave_v1(_limit integer DEFAULT NULL)
RETURNS TABLE(distributed int, skipped int, remaining int)
LANGUAGE sql AS $$ SELECT 0, 0, 0; $$;
-- NOTE: _v1 acima são stubs (a versão prévia fica preservada no histórico de migrations
-- 20260622174610 / 20260622175618 / 20260622180106 / 20260623003915 / 20260623005642).
-- Para rollback, basta re-executar a migration mais recente daquela cadeia.

-- 3) Helper: consumir um único target -------------------------------------------
CREATE OR REPLACE FUNCTION public.engine_try_consume_target(_target_id uuid, _now timestamptz)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t   record;
  v_mp  record;
  v_in_cooldown boolean;
  v_already boolean;
  v_placement_id uuid;
BEGIN
  SELECT * INTO v_t FROM public.catalog_distribution_plan_targets
   WHERE id = _target_id AND status = 'pending' FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT mp.archived_at,
         COALESCE(o.available_slots, mp.catalog_capacity, 0) AS available
    INTO v_mp
    FROM public.managed_playlists mp
    LEFT JOIN public.v_catalog_playlist_occupancy o ON o.managed_playlist_id = mp.id
   WHERE mp.id = v_t.managed_playlist_id;

  IF v_mp.archived_at IS NOT NULL THEN
    UPDATE public.catalog_distribution_plan_targets
       SET status='skipped', skip_reason='playlist_archived', updated_at=_now
     WHERE id = _target_id;
    RETURN false;
  END IF;

  IF COALESCE(v_mp.available,0) <= 0 THEN
    UPDATE public.catalog_distribution_plan_targets
       SET status='skipped', skip_reason='no_capacity', updated_at=_now
     WHERE id = _target_id;
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.playlist_cooldowns pc
     WHERE pc.playlist_id = v_t.managed_playlist_id
       AND pc.action_type IN ('tracks_light','tracks_recycle')
       AND pc.cooldown_until > _now
  ) INTO v_in_cooldown;
  IF v_in_cooldown THEN
    UPDATE public.catalog_distribution_plan_targets
       SET status='skipped', skip_reason='cooldown', updated_at=_now
     WHERE id = _target_id;
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.catalog_placements cp
     WHERE cp.catalog_track_id = v_t.catalog_track_id
       AND cp.managed_playlist_id = v_t.managed_playlist_id
       AND cp.status IN ('pending','active')
  ) INTO v_already;
  IF v_already THEN
    UPDATE public.catalog_distribution_plan_targets
       SET status='skipped', skip_reason='already_present', updated_at=_now
     WHERE id = _target_id;
    RETURN false;
  END IF;

  INSERT INTO public.catalog_placements (
    catalog_track_id, managed_playlist_id, status, scheduled_for, origin
  ) VALUES (
    v_t.catalog_track_id, v_t.managed_playlist_id, 'pending', _now, 'CATALOG'
  ) RETURNING id INTO v_placement_id;

  UPDATE public.catalog_distribution_plan_targets
     SET status='scheduled', scheduled_for=_now, distributed_at=_now,
         placement_id=v_placement_id, skip_reason=NULL, updated_at=_now
   WHERE id = _target_id;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.engine_try_consume_target(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_try_consume_target(uuid, timestamptz) TO service_role;

-- 4) engine_create_distribution_plan — insere 100% dos elegíveis ----------------
CREATE OR REPLACE FUNCTION public.engine_create_distribution_plan(_track_id uuid, _days smallint DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan_id uuid;
  v_existing uuid;
  v_track record;
  v_days smallint;
  v_now timestamptz := now();
  v_inserted int := 0;
BEGIN
  SELECT id, status, genre_id INTO v_track FROM public.catalog_tracks WHERE id = _track_id;
  IF v_track.id IS NULL OR v_track.status <> 'active' THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.catalog_distribution_plans
   WHERE catalog_track_id = _track_id AND status='active' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  v_days := GREATEST(1, LEAST(COALESCE(_days, 5), 30));

  INSERT INTO public.catalog_distribution_plans (
    catalog_track_id, status, window_days, total_eligible, priority,
    started_at, expected_end_at, next_wave_at, notes
  ) VALUES (
    _track_id, 'active', v_days, 0, 5,
    v_now, v_now + (v_days || ' days')::interval, v_now,
    'scheduler_v3_capacity'
  ) RETURNING id INTO v_plan_id;

  -- Insere TODOS os elegíveis como targets pending
  INSERT INTO public.catalog_distribution_plan_targets (
    plan_id, catalog_track_id, managed_playlist_id, status, scheduled_for
  )
  SELECT v_plan_id, _track_id, o.managed_playlist_id, 'pending', v_now
    FROM public.v_catalog_playlist_occupancy o
    JOIN public.managed_playlists mp ON mp.id = o.managed_playlist_id
   WHERE o.archived_at IS NULL
     AND o.available_slots > 0
     AND (v_track.genre_id IS NULL OR mp.genre_id IS NULL OR mp.genre_id = v_track.genre_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.playlist_cooldowns pc
        WHERE pc.playlist_id = o.managed_playlist_id
          AND pc.action_type IN ('tracks_light','tracks_recycle')
          AND pc.cooldown_until > v_now)
     AND NOT EXISTS (
       SELECT 1 FROM public.catalog_placements cp
        WHERE cp.catalog_track_id = _track_id
          AND cp.managed_playlist_id = o.managed_playlist_id
          AND cp.status IN ('pending','active'))
  ON CONFLICT (plan_id, managed_playlist_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.catalog_distribution_plans
     SET total_eligible = v_inserted,
         status = CASE WHEN v_inserted = 0 THEN 'empty' ELSE 'active' END,
         next_wave_at = CASE WHEN v_inserted = 0 THEN NULL ELSE v_now END,
         completed_at = CASE WHEN v_inserted = 0 THEN v_now ELSE NULL END,
         updated_at = v_now
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END $$;

REVOKE ALL ON FUNCTION public.engine_create_distribution_plan(uuid, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_create_distribution_plan(uuid, smallint) TO service_role, authenticated;

-- 5) engine_run_distribution_wave — scheduler capacity-based --------------------
CREATE OR REPLACE FUNCTION public.engine_run_distribution_wave(_limit integer DEFAULT NULL)
RETURNS TABLE(distributed int, skipped int, remaining int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  DELETE FROM _wave_plans;

  -- Agregados globais sobre planos ativos com targets pending
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

  -- Orçamento global do ciclo
  v_budget_day := CEIL(v_global_pending::numeric / GREATEST(1.0, (v_sum_days / GREATEST(1,v_n_plans))));
  v_budget_cycle := LEAST(
    GREATEST(1, CEIL(v_budget_day::numeric / v_cycles_per_day)::int),
    v_cap_per_cycle
  );
  IF _limit IS NOT NULL THEN
    v_budget_cycle := LEAST(v_budget_cycle, GREATEST(1,_limit));
  END IF;

  -- Calcula urgency por plano e popula temp
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

  -- quota proporcional, floor 1
  UPDATE _wave_plans
     SET quota = GREATEST(1, FLOOR(v_budget_cycle * urgency / v_sum_urgency)::int);

  -- Passada 1: tenta consumir quota por plano (ordem urgency DESC)
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

  -- Passada 2: redistribui sobra no mesmo ciclo
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

  -- Atualiza contadores dos planos
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

  -- Marca concluídos
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
END $$;

REVOKE ALL ON FUNCTION public.engine_run_distribution_wave(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_run_distribution_wave(integer) TO service_role, authenticated;

-- 6) distribute_catalog_track — sem cap 90, sem fallback ------------------------
CREATE OR REPLACE FUNCTION public.distribute_catalog_track(
  p_spotify_track_id text,
  p_genre_id uuid,
  p_spotify_uri text DEFAULT NULL,
  p_isrc text DEFAULT NULL,
  p_track_name text DEFAULT NULL,
  p_artist_name text DEFAULT NULL,
  p_cover_url text DEFAULT NULL,
  p_baseline_popularity integer DEFAULT NULL,
  p_baseline_monthly_listeners bigint DEFAULT NULL,
  p_baseline_streams bigint DEFAULT NULL,
  p_baseline_raw jsonb DEFAULT NULL,
  p_added_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_track_row catalog_tracks%ROWTYPE;
  v_track_id uuid;
  v_is_new boolean := false;
  v_prev_genre_id uuid;
  v_plan_id uuid;
  v_total_targets int := 0;
  v_wave record;
BEGIN
  IF p_spotify_track_id IS NULL OR length(trim(p_spotify_track_id))=0 THEN
    RAISE EXCEPTION 'spotify_track_id obrigatório';
  END IF;
  IF p_genre_id IS NULL THEN RAISE EXCEPTION 'genre_id obrigatório'; END IF;
  IF p_track_name IS NULL OR p_artist_name IS NULL THEN
    RAISE EXCEPTION 'track_name e artist_name obrigatórios';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM genres WHERE id = p_genre_id) THEN
    RAISE EXCEPTION 'genre_id inválido';
  END IF;

  SELECT * INTO v_track_row FROM catalog_tracks WHERE spotify_track_id = p_spotify_track_id;
  IF NOT FOUND THEN
    INSERT INTO catalog_tracks(spotify_track_id, spotify_uri, isrc, track_name, artist_name, cover_url, added_by, status, genre_id)
    VALUES (p_spotify_track_id, p_spotify_uri, p_isrc, p_track_name, p_artist_name, p_cover_url, p_added_by, 'active', p_genre_id)
    RETURNING * INTO v_track_row;
    v_is_new := true;
    INSERT INTO catalog_track_baselines(catalog_track_id, streams, popularity, monthly_listeners, raw_payload)
    VALUES (v_track_row.id, p_baseline_streams, p_baseline_popularity, p_baseline_monthly_listeners, p_baseline_raw);
  ELSE
    v_prev_genre_id := v_track_row.genre_id;
    UPDATE catalog_tracks SET
      spotify_uri = COALESCE(spotify_uri, p_spotify_uri),
      isrc        = COALESCE(isrc, p_isrc),
      cover_url   = COALESCE(cover_url, p_cover_url),
      genre_id    = p_genre_id,
      updated_at  = now()
    WHERE id = v_track_row.id;
    v_track_row.genre_id := p_genre_id;
  END IF;

  v_track_id := v_track_row.id;

  -- Cria plano (ou reaproveita existente) + 100% dos targets
  v_plan_id := public.engine_create_distribution_plan(v_track_id, NULL);

  SELECT COALESCE(total_eligible,0) INTO v_total_targets
    FROM public.catalog_distribution_plans WHERE id = v_plan_id;

  -- 1ª onda imediata
  IF v_total_targets > 0 THEN
    SELECT * INTO v_wave FROM public.engine_run_distribution_wave(NULL);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'natural',
    'track', jsonb_build_object(
      'id', v_track_row.id,
      'spotify_track_id', v_track_row.spotify_track_id,
      'spotify_uri', v_track_row.spotify_uri,
      'isrc', v_track_row.isrc,
      'track_name', v_track_row.track_name,
      'artist_name', v_track_row.artist_name,
      'cover_url', v_track_row.cover_url,
      'genre_id', v_track_row.genre_id,
      'is_new', v_is_new,
      'previous_genre_id', v_prev_genre_id,
      'genre_changed', (NOT v_is_new AND v_prev_genre_id IS DISTINCT FROM p_genre_id)
    ),
    'distribution_plan_id', v_plan_id,
    'total_targets', v_total_targets,
    'first_wave_distributed', COALESCE(v_wave.distributed,0),
    'first_wave_remaining', COALESCE(v_wave.remaining, v_total_targets),
    'capped', false
  );
END $$;

-- 7) Trigger autostart: depois de criar plano, dispara 1ª onda ------------------
CREATE OR REPLACE FUNCTION public.trg_catalog_track_create_plan()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan_id uuid;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;

  v_plan_id := public.engine_create_distribution_plan(NEW.id, NULL);
  IF v_plan_id IS NOT NULL THEN
    PERFORM public.engine_run_distribution_wave(NULL);
  END IF;
  RETURN NEW;
END $$;

-- 8) Backfill — completa targets de planos naturais ativos sem targets -----------
INSERT INTO public.catalog_distribution_plan_targets (
  plan_id, catalog_track_id, managed_playlist_id, status, scheduled_for
)
SELECT p.id, p.catalog_track_id, o.managed_playlist_id, 'pending', now()
  FROM public.catalog_distribution_plans p
  JOIN public.catalog_tracks ct ON ct.id = p.catalog_track_id AND ct.status='active'
  JOIN public.v_catalog_playlist_occupancy o ON true
  JOIN public.managed_playlists mp ON mp.id = o.managed_playlist_id
 WHERE p.status='active'
   AND o.archived_at IS NULL
   AND o.available_slots > 0
   AND (ct.genre_id IS NULL OR mp.genre_id IS NULL OR mp.genre_id = ct.genre_id)
   AND NOT EXISTS (
     SELECT 1 FROM public.catalog_distribution_plan_targets t
      WHERE t.plan_id = p.id AND t.managed_playlist_id = o.managed_playlist_id
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.playlist_cooldowns pc
      WHERE pc.playlist_id = o.managed_playlist_id
        AND pc.action_type IN ('tracks_light','tracks_recycle')
        AND pc.cooldown_until > now()
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.catalog_placements cp
      WHERE cp.catalog_track_id = p.catalog_track_id
        AND cp.managed_playlist_id = o.managed_playlist_id
        AND cp.status IN ('pending','active')
   )
ON CONFLICT (plan_id, managed_playlist_id) DO NOTHING;

-- Recalcula total_eligible para refletir real soma de targets
UPDATE public.catalog_distribution_plans p
   SET total_eligible = sub.cnt,
       total_distributed = sub.dist,
       total_skipped = sub.skip,
       updated_at = now()
  FROM (
    SELECT plan_id,
           COUNT(*)::int AS cnt,
           SUM((status IN ('scheduled','processing','done','distributed'))::int)::int AS dist,
           SUM((status IN ('skipped','failed'))::int)::int AS skip
      FROM public.catalog_distribution_plan_targets
     GROUP BY plan_id
  ) sub
 WHERE p.id = sub.plan_id AND p.status='active';
