ALTER TABLE public.catalog_tracks
  ADD COLUMN IF NOT EXISTS catalog_distribution_authorized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_distribution_authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS catalog_distribution_authorized_by uuid;

COMMENT ON COLUMN public.catalog_tracks.catalog_distribution_authorized IS
  'Música cadastrada ≠ autorizada para Catálogo. Só distribute_catalog_track (Catálogo explícito) liga este campo.';

-- Backfill: músicas que já tinham distribuição de Catálogo antes do incidente (27/09 11:13 UTC).
UPDATE public.catalog_tracks ct
   SET catalog_distribution_authorized = true,
       catalog_distribution_authorized_at = COALESCE(ct.created_at, now())
 WHERE EXISTS (
         SELECT 1 FROM public.catalog_distribution_plans d
          WHERE d.catalog_track_id = ct.id AND d.created_at < '2026-09-27 11:13:00+00')
    OR EXISTS (
         SELECT 1 FROM public.catalog_placements cp
          WHERE cp.catalog_track_id = ct.id AND cp.origin = 'CATALOG'
            AND cp.created_at < '2026-09-27 11:13:00+00');

-- Gatilho: só cria plano se a música estiver explicitamente autorizada.
CREATE OR REPLACE FUNCTION public.trg_catalog_track_create_plan()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id uuid;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.catalog_distribution_authorized, false) IS NOT TRUE THEN
    RAISE LOG 'catalog_plan_skipped track=% reason=not_authorized_for_catalog op=%', NEW.id, TG_OP;
    RETURN NEW;
  END IF;

  v_plan_id := public.engine_create_distribution_plan(NEW.id, NULL);
  IF v_plan_id IS NOT NULL THEN
    PERFORM public.engine_run_distribution_wave(NULL);
  END IF;
  RETURN NEW;
END $function$;

-- Catálogo explícito: único fluxo que autoriza.
CREATE OR REPLACE FUNCTION public.distribute_catalog_track(p_spotify_track_id text, p_genre_id uuid, p_spotify_uri text DEFAULT NULL::text, p_isrc text DEFAULT NULL::text, p_track_name text DEFAULT NULL::text, p_artist_name text DEFAULT NULL::text, p_cover_url text DEFAULT NULL::text, p_baseline_popularity integer DEFAULT NULL::integer, p_baseline_monthly_listeners bigint DEFAULT NULL::bigint, p_baseline_streams bigint DEFAULT NULL::bigint, p_baseline_raw jsonb DEFAULT NULL::jsonb, p_added_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_track_row public.catalog_tracks%ROWTYPE;
  v_track_id uuid;
  v_is_new boolean := false;
  v_prev_genre_id uuid;
  v_plan_id uuid;
  v_total_targets int := 0;
BEGIN
  IF p_spotify_track_id IS NULL OR length(trim(p_spotify_track_id)) = 0 THEN
    RAISE EXCEPTION 'spotify_track_id obrigatório';
  END IF;
  IF p_genre_id IS NULL THEN RAISE EXCEPTION 'genre_id obrigatório'; END IF;
  IF p_track_name IS NULL OR p_artist_name IS NULL THEN
    RAISE EXCEPTION 'track_name e artist_name obrigatórios';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.genres WHERE id = p_genre_id) THEN
    RAISE EXCEPTION 'genre_id inválido';
  END IF;

  SELECT * INTO v_track_row FROM public.catalog_tracks WHERE spotify_track_id = p_spotify_track_id;

  IF NOT FOUND THEN
    INSERT INTO public.catalog_tracks(
      spotify_track_id, spotify_uri, isrc, track_name, artist_name,
      cover_url, added_by, status, genre_id,
      catalog_distribution_authorized, catalog_distribution_authorized_at, catalog_distribution_authorized_by
    ) VALUES (
      p_spotify_track_id, p_spotify_uri, p_isrc, p_track_name, p_artist_name,
      p_cover_url, p_added_by, 'active', p_genre_id,
      true, now(), p_added_by
    )
    RETURNING * INTO v_track_row;
    v_is_new := true;
  ELSE
    v_prev_genre_id := v_track_row.genre_id;
    UPDATE public.catalog_tracks SET
      spotify_uri = COALESCE(spotify_uri, p_spotify_uri),
      isrc        = COALESCE(isrc, p_isrc),
      cover_url   = COALESCE(cover_url, p_cover_url),
      genre_id    = p_genre_id,
      catalog_distribution_authorized    = true,
      catalog_distribution_authorized_at = COALESCE(catalog_distribution_authorized_at, now()),
      catalog_distribution_authorized_by = COALESCE(catalog_distribution_authorized_by, p_added_by),
      updated_at  = now()
    WHERE id = v_track_row.id
    RETURNING * INTO v_track_row;
  END IF;

  v_track_id := v_track_row.id;
  v_plan_id := public.engine_create_distribution_plan(v_track_id, NULL);

  SELECT COALESCE(total_eligible, 0) INTO v_total_targets
  FROM public.catalog_distribution_plans WHERE id = v_plan_id;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'occupancy_engine_all_genre_universe',
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
    'total_eligible_playlists', v_total_targets,
    'placements_created', v_total_targets,
    'skipped_already_present', 0,
    'skipped_no_capacity', 0,
    'first_wave_distributed', v_total_targets,
    'first_wave_remaining', 0,
    'capped', false
  );
END;
$function$;

-- Segunda proteção: plano de Catálogo exige autorização explícita.
CREATE OR REPLACE FUNCTION public.engine_create_distribution_plan(_track_id uuid, _days smallint DEFAULT NULL::smallint)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  SELECT id, status, genre_id, spotify_track_id, catalog_distribution_authorized INTO v_track
  FROM public.catalog_tracks WHERE id = _track_id;

  IF v_track.id IS NULL OR v_track.status <> 'active' THEN
    RETURN NULL;
  END IF;

  IF COALESCE(v_track.catalog_distribution_authorized, false) IS NOT TRUE THEN
    RAISE LOG 'engine_create_distribution_plan refused track=% reason=not_authorized_for_catalog', _track_id;
    RETURN NULL;
  END IF;

  v_days := GREATEST(1, LEAST(COALESCE(_days, 5), 30));

  SELECT id INTO v_existing FROM public.catalog_distribution_plans
  WHERE catalog_track_id = _track_id AND status = 'active' LIMIT 1;

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

  DROP TABLE IF EXISTS _catalog_distribution_targets;
  CREATE TEMP TABLE _catalog_distribution_targets ON COMMIT DROP AS
  SELECT mp.id AS managed_playlist_id, mp.name AS playlist_name, mp.spotify_playlist_id,
         row_number() OVER (ORDER BY mp.id) - 1 AS rnk
  FROM public.managed_playlists mp
  WHERE mp.genre_id = v_track.genre_id
    AND COALESCE(mp.operational_status, '') <> 'do_not_operate'
    AND mp.execution_mode = 'API_READY'
    AND mp.playlist_type = 'CATALOG'::public.playlist_type_enum
    AND NOT EXISTS (SELECT 1 FROM public.catalog_placements cp
                    WHERE cp.catalog_track_id = _track_id AND cp.managed_playlist_id = mp.id AND cp.status <> 'removed')
    AND NOT EXISTS (SELECT 1 FROM public.managed_playlist_tracks mpt
                    WHERE mpt.playlist_id = mp.id AND mpt.spotify_track_id = v_track.spotify_track_id);

  SELECT COUNT(*)::int INTO v_total_targets FROM _catalog_distribution_targets;
  v_daily_quota := GREATEST(1, CEIL(v_total_targets::numeric / v_days::numeric)::int);

  INSERT INTO public.catalog_placements (catalog_track_id, managed_playlist_id, status, origin, priority, scheduled_for)
  SELECT _track_id, t.managed_playlist_id, 'pending', 'CATALOG', 2,
         v_now + (FLOOR(t.rnk::numeric / v_daily_quota::numeric) || ' days')::interval
  FROM _catalog_distribution_targets t
  ON CONFLICT (catalog_track_id, managed_playlist_id, copy_index) WHERE status <> 'removed' DO NOTHING;

  WITH cp_rows AS (
    SELECT cp.id AS placement_id, cp.managed_playlist_id, cp.scheduled_for
    FROM public.catalog_placements cp
    JOIN _catalog_distribution_targets t ON t.managed_playlist_id = cp.managed_playlist_id
    WHERE cp.catalog_track_id = _track_id AND cp.status <> 'removed'
  )
  INSERT INTO public.catalog_distribution_plan_targets (
    plan_id, catalog_track_id, managed_playlist_id, status, scheduled_for, distributed_at, placement_id, skip_reason
  )
  SELECT v_plan_id, _track_id, t.managed_playlist_id, 'scheduled', c.scheduled_for, NULL, c.placement_id, NULL
  FROM _catalog_distribution_targets t
  JOIN cp_rows c ON c.managed_playlist_id = t.managed_playlist_id
  ON CONFLICT (plan_id, managed_playlist_id) DO UPDATE
    SET status = 'scheduled', scheduled_for = EXCLUDED.scheduled_for, distributed_at = NULL,
        placement_id = EXCLUDED.placement_id, skip_reason = NULL, updated_at = v_now;

  UPDATE public.catalog_distribution_plans
     SET total_eligible = v_total_targets, total_distributed = 0, total_skipped = 0,
         daily_quota = v_daily_quota,
         status = CASE WHEN v_total_targets = 0 THEN 'empty' ELSE 'active' END,
         next_wave_at = v_now,
         completed_at = CASE WHEN v_total_targets = 0 THEN v_now ELSE NULL END,
         notes = 'occupancy_engine_paced_daily_quota', updated_at = v_now
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END;
$function$;