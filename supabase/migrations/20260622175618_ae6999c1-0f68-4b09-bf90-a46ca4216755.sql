
-- =========================================================
-- Distribuição Natural — Ajustes Finais
-- 1) Plano dinâmico (recalcula elegibilidade onda a onda)
-- 2) Limite diário de exposição por música
-- 3) Distribuição paralela / diversificada entre músicas
-- =========================================================

-- 1) Novas configurações
ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS engine_natural_distribution_max_per_track_per_day smallint NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS engine_natural_distribution_max_per_wave_per_track smallint NOT NULL DEFAULT 1;

-- 2) engine_create_distribution_plan: plano enxuto, sem materializar targets
CREATE OR REPLACE FUNCTION public.engine_create_distribution_plan(
  _track_id uuid,
  _days smallint DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
  v_days smallint;
  v_existing uuid;
  v_track record;
  v_eligible_count integer := 0;
  v_now timestamptz := now();
BEGIN
  SELECT id, status, genre_id INTO v_track FROM public.catalog_tracks WHERE id = _track_id;
  IF v_track.id IS NULL OR v_track.status <> 'active' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_existing
  FROM public.catalog_distribution_plans
  WHERE catalog_track_id = _track_id AND status = 'active'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT COALESCE(_days, engine_natural_distribution_window_days, 5)
    INTO v_days
  FROM public.system_flags ORDER BY id LIMIT 1;
  v_days := GREATEST(1, LEAST(v_days, 30));

  -- snapshot informativo de elegibilidade no momento da criação
  SELECT COUNT(*) INTO v_eligible_count
  FROM public.v_catalog_playlist_occupancy o
  JOIN public.managed_playlists mp ON mp.id = o.managed_playlist_id
  WHERE o.archived_at IS NULL
    AND o.available_slots > 0
    AND (v_track.genre_id IS NULL OR mp.genre_id IS NULL OR mp.genre_id = v_track.genre_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.playlist_cooldowns pc
      WHERE pc.playlist_id = o.managed_playlist_id
        AND pc.action_type IN ('tracks_light','tracks_recycle')
        AND pc.cooldown_until > v_now
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.catalog_placements cp
      WHERE cp.catalog_track_id = _track_id
        AND cp.managed_playlist_id = o.managed_playlist_id
        AND cp.status IN ('pending','active')
    );

  INSERT INTO public.catalog_distribution_plans (
    catalog_track_id, status, window_days, total_eligible,
    started_at, expected_end_at, next_wave_at, notes
  )
  VALUES (
    _track_id,
    CASE WHEN v_eligible_count = 0 THEN 'empty' ELSE 'active' END,
    v_days, v_eligible_count,
    v_now,
    v_now + (v_days || ' days')::interval,
    CASE WHEN v_eligible_count = 0 THEN NULL ELSE v_now END,
    'dynamic_plan_v2'
  )
  RETURNING id INTO v_plan_id;

  IF v_eligible_count = 0 THEN
    UPDATE public.catalog_distribution_plans
       SET completed_at = v_now WHERE id = v_plan_id;
  END IF;

  RETURN v_plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.engine_create_distribution_plan(uuid, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_create_distribution_plan(uuid, smallint) TO service_role, authenticated;

-- 3) engine_run_distribution_wave: round-robin entre planos, eligibility dinâmica, daily cap
CREATE OR REPLACE FUNCTION public.engine_run_distribution_wave(_limit integer DEFAULT NULL)
RETURNS TABLE(distributed integer, skipped integer, remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active boolean;
  v_default_wave smallint;
  v_per_track_wave smallint;
  v_daily_cap smallint;
  v_now timestamptz := now();
  v_today_start timestamptz := date_trunc('day', now());
  v_limit integer;
  v_dist integer := 0;
  v_skip integer := 0;
  v_rem integer := 0;
  v_global_done integer := 0;
  v_pass integer := 0;
  v_max_passes integer := 0;
  v_placed_this_pass integer;
  v_plan record;
  v_picked_today integer;
  v_picked_this_wave integer;
  v_pl record;
  v_placement_id uuid;
  v_exists boolean;
BEGIN
  SELECT engine_natural_distribution_active,
         engine_natural_distribution_wave_size,
         engine_natural_distribution_max_per_wave_per_track,
         engine_natural_distribution_max_per_track_per_day
    INTO v_active, v_default_wave, v_per_track_wave, v_daily_cap
  FROM public.system_flags ORDER BY id LIMIT 1;

  IF NOT COALESCE(v_active, false) THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  v_limit := COALESCE(_limit, v_default_wave, 50);
  v_limit := GREATEST(1, LEAST(v_limit, 1000));
  v_per_track_wave := GREATEST(1, COALESCE(v_per_track_wave, 1));
  v_daily_cap := GREATEST(1, COALESCE(v_daily_cap, 20));

  -- Round-robin: cada "passe" pega no máximo v_per_track_wave playlists por plano.
  -- Repetimos passes até atingir v_limit global ou nenhum progresso.
  v_max_passes := 20;

  WHILE v_global_done < v_limit AND v_pass < v_max_passes LOOP
    v_pass := v_pass + 1;
    v_placed_this_pass := 0;

    FOR v_plan IN
      SELECT p.id AS plan_id, p.catalog_track_id, ct.genre_id
        FROM public.catalog_distribution_plans p
        JOIN public.catalog_tracks ct ON ct.id = p.catalog_track_id
       WHERE p.status = 'active'
         AND ct.status = 'active'
         AND (p.next_wave_at IS NULL OR p.next_wave_at <= v_now)
       ORDER BY COALESCE(p.next_wave_at, p.started_at), p.id
    LOOP
      EXIT WHEN v_global_done >= v_limit;

      -- já atingiu cap diário?
      SELECT COUNT(*) INTO v_picked_today
        FROM public.catalog_distribution_plan_targets t
       WHERE t.catalog_track_id = v_plan.catalog_track_id
         AND t.status = 'distributed'
         AND t.distributed_at >= v_today_start;
      IF v_picked_today >= v_daily_cap THEN
        UPDATE public.catalog_distribution_plans
           SET next_wave_at = v_today_start + interval '1 day',
               updated_at = v_now
         WHERE id = v_plan.plan_id;
        CONTINUE;
      END IF;

      v_picked_this_wave := 0;

      -- escolhe até v_per_track_wave playlists ELEGÍVEIS AGORA (estado atual)
      FOR v_pl IN
        SELECT o.managed_playlist_id
          FROM public.v_catalog_playlist_occupancy o
          JOIN public.managed_playlists mp ON mp.id = o.managed_playlist_id
         WHERE o.archived_at IS NULL
           AND o.available_slots > 0
           AND (v_plan.genre_id IS NULL OR mp.genre_id IS NULL OR mp.genre_id = v_plan.genre_id)
           AND NOT EXISTS (
             SELECT 1 FROM public.playlist_cooldowns pc
              WHERE pc.playlist_id = o.managed_playlist_id
                AND pc.action_type IN ('tracks_light','tracks_recycle')
                AND pc.cooldown_until > v_now
           )
           AND NOT EXISTS (
             SELECT 1 FROM public.catalog_placements cp
              WHERE cp.catalog_track_id = v_plan.catalog_track_id
                AND cp.managed_playlist_id = o.managed_playlist_id
                AND cp.status IN ('pending','active')
           )
           AND NOT EXISTS (
             SELECT 1 FROM public.catalog_distribution_plan_targets tx
              WHERE tx.plan_id = v_plan.plan_id
                AND tx.managed_playlist_id = o.managed_playlist_id
           )
         ORDER BY random()
         LIMIT v_per_track_wave
      LOOP
        EXIT WHEN v_picked_this_wave >= v_per_track_wave;
        EXIT WHEN v_global_done >= v_limit;
        EXIT WHEN (v_picked_today + v_picked_this_wave) >= v_daily_cap;

        -- segurança extra: placement existente
        SELECT EXISTS(
          SELECT 1 FROM public.catalog_placements cp
           WHERE cp.catalog_track_id = v_plan.catalog_track_id
             AND cp.managed_playlist_id = v_pl.managed_playlist_id
             AND cp.status IN ('pending','active')
        ) INTO v_exists;
        IF v_exists THEN CONTINUE; END IF;

        INSERT INTO public.catalog_placements (
          catalog_track_id, managed_playlist_id, status, scheduled_for, origin
        )
        VALUES (
          v_plan.catalog_track_id, v_pl.managed_playlist_id, 'pending', v_now, 'CATALOG'
        )
        RETURNING id INTO v_placement_id;

        INSERT INTO public.catalog_distribution_plan_targets (
          plan_id, catalog_track_id, managed_playlist_id,
          status, scheduled_for, distributed_at, placement_id
        )
        VALUES (
          v_plan.plan_id, v_plan.catalog_track_id, v_pl.managed_playlist_id,
          'distributed', v_now, v_now, v_placement_id
        )
        ON CONFLICT (plan_id, managed_playlist_id) DO NOTHING;

        v_dist := v_dist + 1;
        v_global_done := v_global_done + 1;
        v_picked_this_wave := v_picked_this_wave + 1;
        v_placed_this_pass := v_placed_this_pass + 1;
      END LOOP;

      -- atualiza next_wave_at: amanhã se atingiu daily cap; senão pequeno espaçamento
      IF (v_picked_today + v_picked_this_wave) >= v_daily_cap THEN
        UPDATE public.catalog_distribution_plans
           SET next_wave_at = v_today_start + interval '1 day',
               updated_at = v_now
         WHERE id = v_plan.plan_id;
      ELSE
        UPDATE public.catalog_distribution_plans
           SET next_wave_at = v_now + interval '15 minutes',
               updated_at = v_now
         WHERE id = v_plan.plan_id;
      END IF;
    END LOOP;

    EXIT WHEN v_placed_this_pass = 0;
  END LOOP;

  -- recalcula contadores e status dos planos
  UPDATE public.catalog_distribution_plans p
     SET total_distributed = COALESCE(sub.dist, 0),
         total_skipped = COALESCE(sub.skip, 0),
         updated_at = v_now
    FROM (
      SELECT plan_id,
             SUM((status='distributed')::int) AS dist,
             SUM((status='skipped')::int)     AS skip
        FROM public.catalog_distribution_plan_targets
       GROUP BY plan_id
    ) sub
   WHERE p.id = sub.plan_id;

  -- marca plano como completed se total_distributed >= total_eligible (snapshot)
  UPDATE public.catalog_distribution_plans
     SET status = 'completed',
         completed_at = v_now,
         next_wave_at = NULL,
         updated_at = v_now
   WHERE status = 'active'
     AND total_eligible > 0
     AND total_distributed >= total_eligible;

  -- estimativa de pendências remanescentes: total_eligible - total_distributed
  SELECT GREATEST(0, COALESCE(SUM(total_eligible - total_distributed), 0))::int
    INTO v_rem
    FROM public.catalog_distribution_plans
   WHERE status = 'active';

  RETURN QUERY SELECT v_dist, v_skip, v_rem;
END;
$$;

REVOKE ALL ON FUNCTION public.engine_run_distribution_wave(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engine_run_distribution_wave(integer) TO service_role, authenticated;
