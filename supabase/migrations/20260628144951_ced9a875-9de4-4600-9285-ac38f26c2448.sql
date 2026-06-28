CREATE OR REPLACE FUNCTION public.block_curator_playlist_if_eco()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _eco_id uuid;
BEGIN
  IF NEW.spotify_playlist_id IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO _eco_id FROM public.managed_playlists
   WHERE spotify_playlist_id = NEW.spotify_playlist_id
     AND playlist_type <> 'ARCHIVED'::public.playlist_type_enum
   LIMIT 1;
  IF _eco_id IS NOT NULL THEN
    RAISE EXCEPTION 'PLAYLIST_IS_ECOSYSTEM: spotify_playlist_id=% pertence ao ecossistema (managed_playlist=%)', NEW.spotify_playlist_id, _eco_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_playlist_for_deal(_deal_id uuid, _spotify_playlist_id text, _spotify_url text, _playlist_name text, _followers bigint DEFAULT NULL::bigint, _image_url text DEFAULT NULL::text, _spotify_owner_id text DEFAULT NULL::text, _spotify_owner_name text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _eco_id uuid; _existing_id uuid; _existing_deal uuid; _existing_curator uuid; _new_id uuid;
BEGIN
  IF _spotify_playlist_id IS NOT NULL THEN
    SELECT id INTO _eco_id FROM public.managed_playlists
     WHERE spotify_playlist_id = _spotify_playlist_id
       AND playlist_type <> 'ARCHIVED'::public.playlist_type_enum
     LIMIT 1;
    IF _eco_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','ecosystem','managed_playlist_id', _eco_id,'spotify_playlist_id', _spotify_playlist_id);
    END IF;
    SELECT cp.id, cp.deal_id, cd.curator_id INTO _existing_id, _existing_deal, _existing_curator
      FROM public.curator_playlists cp JOIN public.curator_deals cd ON cd.id = cp.deal_id
     WHERE cp.spotify_playlist_id = _spotify_playlist_id AND cp.deal_id <> _deal_id
     ORDER BY cp.added_at DESC LIMIT 1;
    IF _existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','conflict','existing_curator_playlist_id', _existing_id,'existing_deal_id', _existing_deal,'existing_curator_id', _existing_curator);
    END IF;
    SELECT id INTO _existing_id FROM public.curator_playlists
     WHERE deal_id = _deal_id AND spotify_playlist_id = _spotify_playlist_id LIMIT 1;
    IF _existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','already_claimed','curator_playlist_id', _existing_id);
    END IF;
  END IF;
  INSERT INTO public.curator_playlists(deal_id, spotify_playlist_id, spotify_url, playlist_name, followers, image_url, spotify_owner_id, spotify_owner_name, match_status, attribution_method)
  VALUES (_deal_id, _spotify_playlist_id, _spotify_url, _playlist_name, _followers, _image_url, _spotify_owner_id, _spotify_owner_name, 'unmatched', 'manual_paste')
  RETURNING id INTO _new_id;
  RETURN jsonb_build_object('status','claimed','curator_playlist_id', _new_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.engine_backfill_legacy_distribution_plan(_track_id uuid, _days smallint DEFAULT 5)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_plan_id uuid; v_existing uuid; v_track record; v_days smallint; v_now timestamptz := now(); v_done_count int := 0; v_pending_count int := 0;
BEGIN
  SELECT id, status, genre_id INTO v_track FROM public.catalog_tracks WHERE id = _track_id;
  IF v_track.id IS NULL OR v_track.status <> 'active' THEN RETURN NULL; END IF;
  SELECT id INTO v_existing FROM public.catalog_distribution_plans WHERE catalog_track_id = _track_id AND status = 'active' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  v_days := GREATEST(1::smallint, LEAST(COALESCE(_days, 5::smallint), 30::smallint));
  INSERT INTO public.catalog_distribution_plans (catalog_track_id, status, window_days, total_eligible, priority, started_at, expected_end_at, next_wave_at, notes)
  VALUES (_track_id, 'active', v_days, 0, 5, v_now, v_now + (v_days || ' days')::interval, v_now, 'legacy_backfill_v1')
  RETURNING id INTO v_plan_id;
  INSERT INTO public.catalog_distribution_plan_targets (plan_id, catalog_track_id, managed_playlist_id, status, scheduled_for, distributed_at, placement_id)
  SELECT v_plan_id, _track_id, cp.managed_playlist_id, 'done', COALESCE(cp.added_at, v_now), COALESCE(cp.added_at, v_now), cp.id
    FROM public.catalog_placements cp
   WHERE cp.catalog_track_id = _track_id AND cp.status IN ('pending','active') AND cp.managed_playlist_id IS NOT NULL
  ON CONFLICT (plan_id, managed_playlist_id) DO NOTHING;
  GET DIAGNOSTICS v_done_count = ROW_COUNT;
  INSERT INTO public.catalog_distribution_plan_targets (plan_id, catalog_track_id, managed_playlist_id, status, scheduled_for)
  SELECT v_plan_id, _track_id, o.managed_playlist_id, 'pending', v_now
    FROM public.v_catalog_playlist_occupancy o
    JOIN public.managed_playlists mp ON mp.id = o.managed_playlist_id
   WHERE mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum
     AND o.available_slots > 0
     AND (v_track.genre_id IS NULL OR mp.genre_id IS NULL OR mp.genre_id = v_track.genre_id)
     AND NOT EXISTS (SELECT 1 FROM public.playlist_cooldowns pc WHERE pc.playlist_id = o.managed_playlist_id AND pc.action_type IN ('tracks_light','tracks_recycle') AND pc.cooldown_until > v_now)
     AND NOT EXISTS (SELECT 1 FROM public.catalog_placements cp WHERE cp.catalog_track_id = _track_id AND cp.managed_playlist_id = o.managed_playlist_id AND cp.status IN ('pending','active'))
  ON CONFLICT (plan_id, managed_playlist_id) DO NOTHING;
  GET DIAGNOSTICS v_pending_count = ROW_COUNT;
  UPDATE public.catalog_distribution_plans
     SET total_eligible = v_done_count + v_pending_count,
         total_distributed = v_done_count,
         status = CASE WHEN (v_done_count + v_pending_count) = 0 THEN 'empty' WHEN v_pending_count = 0 THEN 'completed' ELSE 'active' END,
         next_wave_at = CASE WHEN v_pending_count = 0 THEN NULL ELSE v_now END,
         completed_at = CASE WHEN v_pending_count = 0 THEN v_now ELSE NULL END,
         updated_at = v_now
   WHERE id = v_plan_id;
  RETURN v_plan_id;
END $function$;

CREATE OR REPLACE FUNCTION public.engine_propose_playlist_occupancy(p_playlist_id uuid DEFAULT NULL::uuid, p_max_per_playlist integer DEFAULT 10, p_max_playlists integer DEFAULT 50)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_run_id uuid; v_playlists_scanned int := 0; v_playlists_with_gap int := 0; v_proposals int := 0; v_candidates int := 0; v_pl record;
BEGIN
  INSERT INTO public.engine_occupancy_runs (mode, scope_playlist_id) VALUES ('dry_run', p_playlist_id) RETURNING id INTO v_run_id;
  FOR v_pl IN
    SELECT o.managed_playlist_id, o.available_slots, mp.genre_id
      FROM public.v_catalog_playlist_occupancy o JOIN public.managed_playlists mp ON mp.id = o.managed_playlist_id
     WHERE mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum
       AND o.available_slots > 0
       AND (p_playlist_id IS NULL OR o.managed_playlist_id = p_playlist_id)
       AND NOT EXISTS (SELECT 1 FROM public.playlist_cooldowns pc WHERE pc.playlist_id = o.managed_playlist_id AND pc.action_type IN ('tracks_light','tracks_recycle') AND pc.cooldown_until > now())
     ORDER BY o.available_slots DESC LIMIT GREATEST(p_max_playlists, 1)
  LOOP
    v_playlists_scanned := v_playlists_scanned + 1;
    v_playlists_with_gap := v_playlists_with_gap + 1;
    WITH candidates AS (
      SELECT ct.id AS catalog_track_id, row_number() OVER (ORDER BY ct.id) AS rn
        FROM public.catalog_tracks ct
       WHERE ct.status = 'active' AND (v_pl.genre_id IS NULL OR ct.genre_id = v_pl.genre_id)
         AND NOT EXISTS (SELECT 1 FROM public.catalog_placements cp WHERE cp.catalog_track_id = ct.id AND cp.managed_playlist_id = v_pl.managed_playlist_id AND cp.status <> 'removed')
       LIMIT GREATEST(p_max_per_playlist, 1)
    ), inserted AS (
      INSERT INTO public.engine_occupancy_proposals (run_id, managed_playlist_id, catalog_track_id, slot_index, available_slots_at_run, reason, match_components)
      SELECT v_run_id, v_pl.managed_playlist_id, c.catalog_track_id, c.rn::int, v_pl.available_slots,
             CASE WHEN v_pl.genre_id IS NULL THEN 'any_genre' ELSE 'genre_match' END,
             jsonb_build_object('genre_id', v_pl.genre_id, 'available_slots', v_pl.available_slots)
        FROM candidates c RETURNING 1
    ) SELECT COUNT(*) INTO v_candidates FROM inserted;
    v_proposals := v_proposals + COALESCE(v_candidates, 0);
  END LOOP;
  UPDATE public.engine_occupancy_runs SET finished_at = now(), playlists_scanned = v_playlists_scanned, playlists_with_gap = v_playlists_with_gap, proposals_generated = v_proposals, candidates_considered = v_proposals WHERE id = v_run_id;
  RETURN v_run_id;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.engine_occupancy_runs SET finished_at = now(), error = SQLERRM WHERE id = v_run_id;
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.engine_try_consume_target(_target_id uuid, _now timestamp with time zone)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t record; v_mp record; v_in_cooldown boolean; v_already boolean; v_placement_id uuid;
BEGIN
  SELECT * INTO v_t FROM public.catalog_distribution_plan_targets WHERE id = _target_id AND status = 'pending' FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT mp.playlist_type, COALESCE(o.available_slots, mp.catalog_capacity, 0) AS available INTO v_mp
    FROM public.managed_playlists mp LEFT JOIN public.v_catalog_playlist_occupancy o ON o.managed_playlist_id = mp.id
   WHERE mp.id = v_t.managed_playlist_id;
  IF v_mp.playlist_type = 'ARCHIVED'::public.playlist_type_enum THEN
    UPDATE public.catalog_distribution_plan_targets SET status='skipped', skip_reason='playlist_archived', updated_at=_now WHERE id = _target_id;
    RETURN false;
  END IF;
  IF COALESCE(v_mp.available,0) <= 0 THEN
    UPDATE public.catalog_distribution_plan_targets SET status='skipped', skip_reason='no_capacity', updated_at=_now WHERE id = _target_id;
    RETURN false;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.playlist_cooldowns pc WHERE pc.playlist_id = v_t.managed_playlist_id AND pc.action_type IN ('tracks_light','tracks_recycle') AND pc.cooldown_until > _now) INTO v_in_cooldown;
  IF v_in_cooldown THEN
    UPDATE public.catalog_distribution_plan_targets SET status='skipped', skip_reason='cooldown', updated_at=_now WHERE id = _target_id;
    RETURN false;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.catalog_placements cp WHERE cp.catalog_track_id = v_t.catalog_track_id AND cp.managed_playlist_id = v_t.managed_playlist_id AND cp.status <> 'removed') INTO v_already;
  IF v_already THEN
    UPDATE public.catalog_distribution_plan_targets SET status='skipped', skip_reason='already_present', updated_at=_now WHERE id = _target_id;
    RETURN false;
  END IF;
  INSERT INTO public.catalog_placements (catalog_track_id, managed_playlist_id, status, scheduled_for, origin)
  VALUES (v_t.catalog_track_id, v_t.managed_playlist_id, 'pending', _now, 'CATALOG')
  ON CONFLICT (catalog_track_id, managed_playlist_id) WHERE status <> 'removed' DO NOTHING
  RETURNING id INTO v_placement_id;
  IF v_placement_id IS NULL THEN
    UPDATE public.catalog_distribution_plan_targets SET status='skipped', skip_reason='already_present', updated_at=_now WHERE id = _target_id;
    RETURN false;
  END IF;
  UPDATE public.catalog_distribution_plan_targets SET status='scheduled', scheduled_for=_now, distributed_at=_now, placement_id=v_placement_id, skip_reason=NULL, updated_at=_now WHERE id = _target_id;
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_force_observational_if_ecosystem()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.spotify_playlist_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.managed_playlists mp WHERE mp.spotify_playlist_id = NEW.spotify_playlist_id AND mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum) THEN
      NEW.is_observational := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_blocked_playlist_ids()
 RETURNS TABLE(playlist_id uuid, app_id uuid, app_name text, blocked_until timestamp with time zone)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH blocked_apps AS (
    SELECT a.id, a.name, cb.blocked_until FROM public.spotify_apps a
    JOIN public.spotify_circuit_breaker cb ON cb.app_id = a.id::text
    WHERE cb.status = 'open' AND cb.blocked_until > now() AND cb.context = 'operation' AND COALESCE(a.retired_from_production, false) = false
  ), user_app AS (
    SELECT DISTINCT ON (spotify_user_id) spotify_user_id, app_id FROM public.spotify_user_tokens
    ORDER BY spotify_user_id, is_default DESC NULLS LAST, updated_at DESC NULLS LAST
  )
  SELECT mp.id, ba.id, ba.name, ba.blocked_until
    FROM public.managed_playlists mp
    JOIN user_app ua ON ua.spotify_user_id = mp.owner_spotify_user_id
    JOIN blocked_apps ba ON ba.id = ua.app_id::uuid
   WHERE mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum AND public.has_team_access();
$function$;

CREATE OR REPLACE FUNCTION public.get_spotify_app_for_playlist(p_playlist_id uuid)
 RETURNS TABLE(app_id uuid, app_name text, app_status text, auth_failure_count integer, circuit_status text, blocked_until timestamp with time zone, retry_after_sec integer, playlists_count bigint, level text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH target AS (SELECT mp.owner_spotify_user_id FROM public.managed_playlists mp WHERE mp.id = p_playlist_id),
  tok AS (SELECT app_id FROM public.spotify_user_tokens WHERE spotify_user_id = (SELECT owner_spotify_user_id FROM target) ORDER BY is_default DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT 1),
  cnt AS (
    SELECT COUNT(*)::bigint AS n FROM public.managed_playlists mp
    JOIN public.spotify_user_tokens t ON t.spotify_user_id = mp.owner_spotify_user_id
    WHERE t.app_id::uuid = (SELECT app_id::uuid FROM tok) AND mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum
  )
  SELECT a.id, a.name, a.status::text, COALESCE(a.auth_failure_count, 0), COALESCE(cb.status, 'closed')::text,
         CASE WHEN cb.status = 'open' AND cb.blocked_until > now() THEN cb.blocked_until ELSE NULL END,
         COALESCE(cb.retry_after_sec, 0), COALESCE((SELECT n FROM cnt), 0)::bigint,
         CASE WHEN cb.status = 'open' AND cb.blocked_until > now() THEN 'blocked'
              WHEN a.status = 'quarantined' OR COALESCE(a.auth_failure_count, 0) >= 3 THEN 'attention'
              ELSE 'healthy' END::text
    FROM public.spotify_apps a LEFT JOIN public.spotify_circuit_breaker cb ON cb.app_id = a.id::text
   WHERE a.id = (SELECT app_id::uuid FROM tok) AND public.has_team_access();
$function$;

CREATE OR REPLACE FUNCTION public.get_spotify_apps_status()
 RETURNS TABLE(app_id uuid, app_name text, app_status text, auth_failure_count integer, quarantined_until timestamp with time zone, circuit_status text, blocked_until timestamp with time zone, retry_after_sec integer, last_429_at timestamp with time zone, playlists_count bigint, level text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH user_app AS (SELECT DISTINCT ON (spotify_user_id) spotify_user_id, app_id FROM public.spotify_user_tokens ORDER BY spotify_user_id, is_default DESC NULLS LAST, updated_at DESC NULLS LAST),
  counts AS (
    SELECT ua.app_id::uuid AS app_id, COUNT(*)::bigint AS n
      FROM public.managed_playlists mp JOIN user_app ua ON ua.spotify_user_id = mp.owner_spotify_user_id
     WHERE mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum GROUP BY ua.app_id
  )
  SELECT a.id, a.name, a.status::text, COALESCE(a.auth_failure_count, 0), a.quarantined_until,
         COALESCE(cb.status, 'closed')::text,
         CASE WHEN cb.status = 'open' AND cb.blocked_until > now() THEN cb.blocked_until ELSE NULL END,
         COALESCE(cb.retry_after_sec, 0), cb.last_429_at, COALESCE(c.n, 0)::bigint,
         CASE WHEN cb.status = 'open' AND cb.blocked_until > now() THEN 'blocked'
              WHEN a.status = 'quarantined' OR COALESCE(a.auth_failure_count, 0) >= 3 THEN 'attention'
              ELSE 'healthy' END::text
    FROM public.spotify_apps a
    LEFT JOIN public.spotify_circuit_breaker cb ON cb.app_id = a.id::text
    LEFT JOIN counts c ON c.app_id = a.id
   WHERE COALESCE(a.retired_from_production, false) = false AND public.has_team_access()
   ORDER BY CASE WHEN cb.status = 'open' AND cb.blocked_until > now() THEN 0
                 WHEN a.status = 'quarantined' OR COALESCE(a.auth_failure_count, 0) >= 3 THEN 1
                 ELSE 2 END, a.name;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_genre_capacity_matrix()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  pos_factors numeric[] := ARRAY[0.12, 0.10, 0.08, 0.07, 0.06, 0.05, 0.045, 0.04, 0.035, 0.03, 0.025, 0.025, 0.025, 0.025, 0.025];
  affected int;
BEGIN
  WITH agg AS (
    SELECT mp.genre_id, SUM(GREATEST(COALESCE(mp.followers, 0), 0))::bigint AS total_followers, COUNT(*)::int AS playlist_count
      FROM public.managed_playlists mp
     WHERE mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum AND mp.genre_id IS NOT NULL
     GROUP BY mp.genre_id
  ), rows AS (
    SELECT agg.genre_id, g.nome AS genre_name, p.pos AS position, agg.total_followers,
           ROUND(agg.total_followers::numeric * (18.0/30.0) * pos_factors[p.pos])::bigint AS plays_x18,
           ROUND(agg.total_followers::numeric * 1.0 * pos_factors[p.pos])::bigint AS plays_x30,
           ROUND(agg.total_followers::numeric * (50.0/30.0) * pos_factors[p.pos])::bigint AS plays_x50,
           agg.playlist_count
      FROM agg JOIN public.genres g ON g.id = agg.genre_id CROSS JOIN generate_series(1, 15) AS p(pos)
  ), upsert AS (
    INSERT INTO public.genre_capacity_matrix (genre_id, genre_name, position, total_followers, plays_per_day_x18, plays_per_day_x30, plays_per_day_x50, playlist_count, updated_at)
    SELECT genre_id, genre_name, position, total_followers, plays_x18, plays_x30, plays_x50, playlist_count, now() FROM rows
    ON CONFLICT (genre_id, position) DO UPDATE SET
      genre_name = EXCLUDED.genre_name, total_followers = EXCLUDED.total_followers,
      plays_per_day_x18 = EXCLUDED.plays_per_day_x18, plays_per_day_x30 = EXCLUDED.plays_per_day_x30,
      plays_per_day_x50 = EXCLUDED.plays_per_day_x50, playlist_count = EXCLUDED.playlist_count, updated_at = now()
    RETURNING 1
  ) SELECT COUNT(*) INTO affected FROM upsert;
  DELETE FROM public.genre_capacity_matrix WHERE genre_id NOT IN (
    SELECT DISTINCT genre_id FROM public.managed_playlists WHERE playlist_type <> 'ARCHIVED'::public.playlist_type_enum AND genre_id IS NOT NULL
  );
  RETURN jsonb_build_object('rows_upserted', affected, 'refreshed_at', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_tier_cold_ids(p_limit integer, p_cutoff_imported timestamp with time zone, p_cutoff_metrics timestamp with time zone, p_cutoff_alloc timestamp with time zone)
 RETURNS TABLE(id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT mp.id FROM managed_playlists mp
   WHERE mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum
     AND mp.diagnose_blocked IS NOT TRUE
     AND NOT EXISTS (SELECT 1 FROM campaign_eco_allocations a LEFT JOIN campaigns c ON c.id = a.campaign_id WHERE a.managed_playlist_id = mp.id AND (c.status IN ('active','planning') OR a.created_at > p_cutoff_alloc))
     AND NOT (COALESCE(mp.imported_at,'epoch'::timestamptz) > p_cutoff_imported OR COALESCE(mp.last_metrics_at,'epoch'::timestamptz) > p_cutoff_metrics)
   ORDER BY COALESCE(mp.last_metrics_at,'epoch'::timestamptz) ASC NULLS FIRST LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.sync_tier_hot_ids(p_limit integer, p_cutoff timestamp with time zone)
 RETURNS TABLE(id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT mp.id FROM managed_playlists mp
   WHERE mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum
     AND mp.diagnose_blocked IS NOT TRUE
     AND EXISTS (SELECT 1 FROM campaign_eco_allocations a JOIN campaigns c ON c.id = a.campaign_id WHERE a.managed_playlist_id = mp.id AND c.status IN ('active','planning'))
   ORDER BY COALESCE(mp.last_metrics_at,'epoch'::timestamptz) ASC LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.sync_tier_warm_ids(p_limit integer, p_cutoff_imported timestamp with time zone, p_cutoff_metrics timestamp with time zone, p_cutoff_alloc timestamp with time zone)
 RETURNS TABLE(id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT mp.id FROM managed_playlists mp
   WHERE mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum
     AND mp.diagnose_blocked IS NOT TRUE
     AND (COALESCE(mp.imported_at,'epoch'::timestamptz) > p_cutoff_imported OR COALESCE(mp.last_metrics_at,'epoch'::timestamptz) > p_cutoff_metrics OR EXISTS (SELECT 1 FROM campaign_eco_allocations a WHERE a.managed_playlist_id = mp.id AND a.created_at > p_cutoff_alloc))
     AND NOT EXISTS (SELECT 1 FROM campaign_eco_allocations a JOIN campaigns c ON c.id = a.campaign_id WHERE a.managed_playlist_id = mp.id AND c.status IN ('active','planning'))
   ORDER BY COALESCE(mp.last_metrics_at,'epoch'::timestamptz) ASC LIMIT p_limit;
$function$;

-- Views
DROP VIEW IF EXISTS public.v_playlist_vps_assignment CASCADE;
CREATE VIEW public.v_playlist_vps_assignment AS
SELECT mp.id AS managed_playlist_id, mp.spotify_playlist_id, mp.canonical_playlist_id,
       a.id AS account_id, a.display_name AS account_name,
       sa.id AS spotify_account_id, sa.session_file_path, sa.status AS account_status,
       v.id AS vps_node_id, v.hostname, v.ip, v.status AS vps_status
  FROM public.managed_playlists mp
  JOIN public.accounts a ON a.id = mp.account_id
  JOIN public.spotify_accounts sa ON sa.account_id = a.id
  LEFT JOIN public.vps_nodes v ON v.id = sa.vps_node_id
 WHERE mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum;

DROP VIEW IF EXISTS public.spotify_app_overview CASCADE;
CREATE VIEW public.spotify_app_overview AS
WITH calls AS (
  SELECT spotify_call_log.app_id,
    count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '00:05:00'::interval)) AS calls_5m,
    count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '01:00:00'::interval)) AS calls_1h,
    count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '24:00:00'::interval)) AS calls_24h,
    count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '7 days'::interval)) AS calls_7d,
    count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '01:00:00'::interval) AND spotify_call_log.http_status = 403) AS err_403_1h,
    count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '01:00:00'::interval) AND spotify_call_log.http_status = 429) AS err_429_1h,
    count(*) FILTER (WHERE spotify_call_log.created_at > (now() - '01:00:00'::interval) AND spotify_call_log.status = 'retry'::text) AS retries_1h,
    avg(spotify_call_log.duration_ms) FILTER (WHERE spotify_call_log.created_at > (now() - '01:00:00'::interval)) AS avg_ms_1h
  FROM spotify_call_log WHERE spotify_call_log.app_id IS NOT NULL GROUP BY spotify_call_log.app_id
), accounts_per_app AS (
  SELECT spotify_user_tokens.app_id, count(*)::integer AS accounts_count
  FROM spotify_user_tokens WHERE spotify_user_tokens.app_id IS NOT NULL GROUP BY spotify_user_tokens.app_id
), playlists_per_app AS (
  SELECT ut.app_id,
    count(*) FILTER (WHERE mp.playlist_type <> 'ARCHIVED'::public.playlist_type_enum)::integer AS active_playlists,
    count(*)::integer AS total_playlists
  FROM managed_playlists mp JOIN accounts a_1 ON a_1.id = mp.account_id
  JOIN spotify_user_tokens ut ON ut.id = a_1.spotify_user_token_id
  WHERE ut.app_id IS NOT NULL GROUP BY ut.app_id
), breaker AS (SELECT spotify_circuit_breaker.app_id, spotify_circuit_breaker.status AS circuit_breaker FROM spotify_circuit_breaker)
SELECT a.id, a.name, a.status, a.lifecycle_state, a.purpose, a.created_at, a.development_mode, a.extended_quota,
  a.blocked_reason, a.quarantined_until, a.removed_from_pool_at,
  COALESCE(ac.accounts_count, 0) AS accounts_count, a.max_accounts,
  COALESCE(pl.active_playlists, 0) AS active_playlists, COALESCE(pl.total_playlists, 0) AS total_playlists, a.max_playlists,
  COALESCE(c.calls_5m, 0::bigint) AS calls_last_5m, COALESCE(c.calls_1h, 0::bigint) AS calls_last_1h,
  COALESCE(c.calls_24h, 0::bigint) AS calls_last_24h, COALESCE(c.calls_7d, 0::bigint) AS calls_last_7d,
  a.cap_calls_per_minute, a.cap_calls_per_hour,
  COALESCE(c.err_403_1h, 0::bigint) AS error_403_last_hour, COALESCE(c.err_429_1h, 0::bigint) AS error_429_last_hour,
  COALESCE(c.retries_1h, 0::bigint) AS retries_last_hour, COALESCE(c.avg_ms_1h, 0::numeric)::integer AS average_latency_ms,
  COALESCE(b.circuit_breaker, 'closed'::text) AS circuit_breaker,
  LEAST(100::numeric, GREATEST(0::numeric, 0.45 * (COALESCE(c.calls_1h, 0::bigint)::numeric / NULLIF(a.cap_calls_per_hour, 0)::numeric * 100::numeric) + 0.30 * (COALESCE(pl.active_playlists, 0)::numeric / NULLIF(a.max_playlists, 0)::numeric * 100::numeric) + 0.25 * (COALESCE(ac.accounts_count, 0)::numeric / NULLIF(a.max_accounts, 0)::numeric * 100::numeric)))::smallint AS capacity_score,
  GREATEST(0::bigint, LEAST(100::bigint, 100 - LEAST(40::bigint, COALESCE(c.err_403_1h, 0::bigint) * 2) - LEAST(30::bigint, COALESCE(c.err_429_1h, 0::bigint)) - LEAST(15::bigint, COALESCE(c.retries_1h, 0::bigint)) -
    CASE WHEN COALESCE(b.circuit_breaker, 'closed'::text) <> 'closed'::text THEN 30 ELSE 0 END -
    CASE WHEN COALESCE(c.avg_ms_1h, 0::numeric) > 1500::numeric THEN 10 ELSE 0 END))::smallint AS health_score,
  a.soft_capacity_cap, a.min_health_score,
  a.lifecycle_state = 'active'::text AND a.status = 'active'::text AND (a.quarantined_until IS NULL OR a.quarantined_until <= now()) AND a.removed_from_pool_at IS NULL AS pool_eligible
FROM spotify_apps a
LEFT JOIN calls c ON c.app_id = a.id
LEFT JOIN accounts_per_app ac ON ac.app_id = a.id
LEFT JOIN playlists_per_app pl ON pl.app_id = a.id
LEFT JOIN breaker b ON b.app_id = a.id::text;

DROP VIEW IF EXISTS public.v_catalog_placement_live CASCADE;
CREATE VIEW public.v_catalog_placement_live AS
SELECT cp.id, cp.catalog_track_id, cp.managed_playlist_id, cp.status,
  cp."position" AS entry_position, mpt."position" AS current_position,
  cp.added_at, cp.scheduled_for, cp.attempts, cp.last_error_code, cp.distribution_batch_id,
  mp.name AS playlist_name, mp.cover_url AS playlist_cover_url, mp.followers AS playlist_followers,
  mp.spotify_playlist_id, mp.archived_at AS playlist_archived_at,
  mp.playlist_type AS playlist_type, mp.execution_mode AS playlist_execution_mode,
  ct.spotify_track_id, mpt.snapshot_at AS position_observed_at
FROM catalog_placements cp
JOIN catalog_tracks ct ON ct.id = cp.catalog_track_id
JOIN managed_playlists mp ON mp.id = cp.managed_playlist_id
LEFT JOIN managed_playlist_tracks mpt ON mpt.playlist_id = cp.managed_playlist_id AND mpt.spotify_track_id = ct.spotify_track_id;

GRANT SELECT ON public.v_playlist_vps_assignment TO authenticated, service_role;
GRANT SELECT ON public.spotify_app_overview TO authenticated, service_role;
GRANT SELECT ON public.v_catalog_placement_live TO authenticated, service_role;