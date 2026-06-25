
-- ============================================================================
-- DAILY PACING: Distribuição uniforme ao longo do prazo (window_days)
-- ----------------------------------------------------------------------------
-- Objetivo: ao gerar o plano de distribuição de uma faixa, em vez de inserir
-- todos os placements como `active` no instante T0 (o que dispara 484/484
-- imediatamente sem nenhuma execução real), agora:
--
--   * placements entram como `pending`
--   * `scheduled_for` é distribuído uniformemente ao longo de `window_days`
--   * meta diária = ceil(total_eligible / window_days)
--   * o claim do executor (`claim_next_catalog_placements`) já respeita
--     `scheduled_for <= now()`, portanto o ritmo é natural
--
-- Exemplo: 484 playlists / 5 dias → 97/dia. O placement de rank 0..96 cai
-- hoje, 97..193 amanhã, e assim por diante. Quando o executor processa
-- (com ou sem vaga, INSERT ou REMOVE+INSERT), respeita a regra do
-- Occupancy Engine.
-- ============================================================================

ALTER TABLE public.catalog_distribution_plans
  ADD COLUMN IF NOT EXISTS daily_quota integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.engine_create_distribution_plan(
  _track_id uuid,
  _days smallint DEFAULT NULL::smallint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id uuid;
  v_existing uuid;
  v_track record;
  v_days smallint;
  v_now timestamptz := now();
  v_total_targets int := 0;
  v_daily_quota int := 1;
BEGIN
  SELECT id, status, genre_id, spotify_track_id INTO v_track
  FROM public.catalog_tracks
  WHERE id = _track_id;

  IF v_track.id IS NULL OR v_track.status <> 'active' THEN
    RETURN NULL;
  END IF;

  v_days := GREATEST(1, LEAST(COALESCE(_days, 5), 30));

  SELECT id INTO v_existing
  FROM public.catalog_distribution_plans
  WHERE catalog_track_id = _track_id
    AND status = 'active'
  LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO public.catalog_distribution_plans (
      catalog_track_id, status, window_days, total_eligible, priority,
      started_at, expected_end_at, next_wave_at, notes
    ) VALUES (
      _track_id, 'active', v_days, 0, 5,
      v_now, v_now + (v_days || ' days')::interval, v_now,
      'occupancy_engine_paced_daily_quota'
    )
    RETURNING id INTO v_plan_id;
  ELSE
    v_plan_id := v_existing;
  END IF;

  -- Universo: gênero menos do_not_operate, menos já presentes (placement ou track local)
  DROP TABLE IF EXISTS _catalog_distribution_targets;
  CREATE TEMP TABLE _catalog_distribution_targets ON COMMIT DROP AS
  SELECT
    mp.id AS managed_playlist_id,
    mp.name AS playlist_name,
    mp.spotify_playlist_id,
    row_number() OVER (ORDER BY mp.id) - 1 AS rnk
  FROM public.managed_playlists mp
  WHERE mp.genre_id = v_track.genre_id
    AND COALESCE(mp.operational_status, '') <> 'do_not_operate'
    AND NOT EXISTS (
      SELECT 1
      FROM public.catalog_placements cp
      WHERE cp.catalog_track_id = _track_id
        AND cp.managed_playlist_id = mp.id
        AND cp.status <> 'removed'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.managed_playlist_tracks mpt
      WHERE mpt.playlist_id = mp.id
        AND mpt.spotify_track_id = v_track.spotify_track_id
    );

  SELECT COUNT(*)::int INTO v_total_targets
  FROM _catalog_distribution_targets;

  -- Meta diária = ceil(total / window_days). Mínimo 1.
  v_daily_quota := GREATEST(1, CEIL(v_total_targets::numeric / v_days::numeric)::int);

  -- Insere placements como `pending` com scheduled_for distribuído ao longo da janela.
  -- placement de rank r → dia = floor(r / daily_quota). scheduled_for = v_now + dia*1day.
  INSERT INTO public.catalog_placements (
    catalog_track_id, managed_playlist_id, status, origin, priority, scheduled_for
  )
  SELECT
    _track_id,
    t.managed_playlist_id,
    'pending',
    'CATALOG',
    2,
    v_now + (FLOOR(t.rnk::numeric / v_daily_quota::numeric) || ' days')::interval
  FROM _catalog_distribution_targets t
  ON CONFLICT (catalog_track_id, managed_playlist_id) WHERE status <> 'removed' DO NOTHING;

  -- Registra targets do plano (apenas tracking, status=scheduled)
  WITH cp_rows AS (
    SELECT cp.id AS placement_id, cp.managed_playlist_id, cp.scheduled_for
    FROM public.catalog_placements cp
    JOIN _catalog_distribution_targets t ON t.managed_playlist_id = cp.managed_playlist_id
    WHERE cp.catalog_track_id = _track_id
      AND cp.status <> 'removed'
  )
  INSERT INTO public.catalog_distribution_plan_targets (
    plan_id, catalog_track_id, managed_playlist_id, status, scheduled_for,
    distributed_at, placement_id, skip_reason
  )
  SELECT
    v_plan_id, _track_id, t.managed_playlist_id, 'scheduled',
    c.scheduled_for, NULL, c.placement_id, NULL
  FROM _catalog_distribution_targets t
  JOIN cp_rows c ON c.managed_playlist_id = t.managed_playlist_id
  ON CONFLICT (plan_id, managed_playlist_id) DO UPDATE
    SET status = 'scheduled',
        scheduled_for = EXCLUDED.scheduled_for,
        distributed_at = NULL,
        placement_id = EXCLUDED.placement_id,
        skip_reason = NULL,
        updated_at = v_now;

  -- Plano permanece `active` até o processador escoar; total_distributed inicia em 0.
  UPDATE public.catalog_distribution_plans
     SET total_eligible = v_total_targets,
         total_distributed = 0,
         total_skipped = 0,
         daily_quota = v_daily_quota,
         status = CASE WHEN v_total_targets = 0 THEN 'empty' ELSE 'active' END,
         next_wave_at = v_now,
         completed_at = CASE WHEN v_total_targets = 0 THEN v_now ELSE NULL END,
         notes = 'occupancy_engine_paced_daily_quota',
         updated_at = v_now
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END;
$function$;
