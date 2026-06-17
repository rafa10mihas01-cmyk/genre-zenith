
-- ============================================================
-- FASE 2.A.2.b — Migrar funções/triggers para fonte oficial
-- ============================================================

-- 1) get_campaign_analytics_overview: órfã -> DROP
DROP FUNCTION IF EXISTS public.get_campaign_analytics_overview();

-- 2) sync_campaign_total_allocated: trocar fonte para campaign_eco_allocations
DROP TRIGGER IF EXISTS trg_sync_camp_alloc ON public.campaign_allocations;

CREATE OR REPLACE FUNCTION public.sync_campaign_total_allocated_from_eco()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_cid uuid;
BEGIN
  v_cid := COALESCE(NEW.campaign_id, OLD.campaign_id);
  UPDATE public.campaigns
     SET total_allocated = COALESCE(
       (SELECT SUM(planned_streams)::bigint
          FROM public.campaign_eco_allocations
         WHERE campaign_id = v_cid
           AND status IN ('pending','dispatched','active','done')),
       0)
   WHERE id = v_cid;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_total_allocated_eco ON public.campaign_eco_allocations;
CREATE TRIGGER trg_sync_total_allocated_eco
AFTER INSERT OR DELETE OR UPDATE OF planned_streams, status, campaign_id
ON public.campaign_eco_allocations
FOR EACH ROW EXECUTE FUNCTION public.sync_campaign_total_allocated_from_eco();

-- Função antiga: mantida em pg_proc apenas porque a trigger antiga referenciava;
-- agora sem trigger associada, pode ir junto.
DROP FUNCTION IF EXISTS public.sync_campaign_total_allocated();

-- 3) client_request_adjustment: snapshot de plano vem de campaign_eco_allocations
CREATE OR REPLACE FUNCTION public.client_request_adjustment(p_token text, p_message text, p_requester_name text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign_id uuid;
  v_camp record;
  v_next_version int;
  v_allocs jsonb;
  v_new_round int;
BEGIN
  IF p_message IS NULL OR length(trim(p_message)) < 3 THEN
    RAISE EXCEPTION 'message_required';
  END IF;

  SELECT id, simulation_snapshot, goal_plays, total_allocated, valor_cobrado, engagement_multiplier, eco_max_pct,
         track_name, artist, client_decision_round
    INTO v_camp
    FROM public.campaigns
   WHERE public_plan_token = p_token;
  IF v_camp.id IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
    FROM public.campaign_plan_versions WHERE campaign_id = v_camp.id;

  -- Snapshot do plano: fonte oficial = campaign_eco_allocations + managed_playlists
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'managed_playlist_id', cea.managed_playlist_id,
           'spotify_playlist_id', mp.spotify_playlist_id,
           'planned_streams',     cea.planned_streams,
           'status',              cea.status,
           'position',            cea.position,
           'start_day',           cea.start_day,
           'genre_source',        cea.genre_source
         ) ORDER BY cea.position NULLS LAST, cea.created_at), '[]'::jsonb)
    INTO v_allocs
    FROM public.campaign_eco_allocations cea
    LEFT JOIN public.managed_playlists mp ON mp.id = cea.managed_playlist_id
   WHERE cea.campaign_id = v_camp.id;

  INSERT INTO public.campaign_plan_versions
    (campaign_id, version, snapshot, goal_plays, total_allocated, valor_cobrado, requested_message, requested_by)
  VALUES
    (v_camp.id, v_next_version,
     jsonb_build_object(
       'simulation_snapshot', v_camp.simulation_snapshot,
       'allocations', v_allocs,
       'engagement_multiplier', v_camp.engagement_multiplier,
       'eco_max_pct', v_camp.eco_max_pct
     ),
     v_camp.goal_plays, v_camp.total_allocated, v_camp.valor_cobrado,
     trim(p_message), NULLIF(trim(COALESCE(p_requester_name,'')), ''));

  v_new_round := COALESCE(v_camp.client_decision_round, 1) + 1;

  UPDATE public.campaigns
     SET client_rejected_at = now(),
         client_adjustment_request = trim(p_message),
         client_approved_at = NULL,
         client_approved_by = COALESCE(trim(p_requester_name), client_approved_by),
         client_decision_round = v_new_round
   WHERE id = v_camp.id
   RETURNING id INTO v_campaign_id;

  BEGIN
    INSERT INTO public.notifications (type, title, message, action_url, metadata, user_id)
    VALUES (
      'warning',
      'Cliente pediu ajuste no plano',
      COALESCE(v_camp.track_name, 'Campanha') || COALESCE(' — ' || v_camp.artist, '') ||
        ' (rodada ' || v_new_round || ')' ||
        COALESCE(' · ' || NULLIF(trim(COALESCE(p_requester_name,'')), ''), ''),
      '/campanhas/' || v_campaign_id::text,
      jsonb_build_object(
        'domain', 'campanhas',
        'kind', 'campaign_plan_decision',
        'decision', 'adjustment_requested',
        'campaign_id', v_campaign_id,
        'round', v_new_round,
        'message', trim(p_message),
        'dedupe_key', 'campaign_plan_decision:' || v_campaign_id::text || ':adjustment:' || v_new_round
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_campaign_id;
END;
$function$;

-- 4) suggest_campaign_playlists: trocar fontes legadas
CREATE OR REPLACE FUNCTION public.suggest_campaign_playlists(p_goal bigint, p_deadline date, p_exclude_active boolean DEFAULT true)
RETURNS TABLE(playlist_id uuid, playlist_name text, followers bigint, cover_url text, capacity_score numeric, health_score numeric, risk_score numeric, delivery_score numeric, campaigns_count integer, fulfillment_rate numeric, expected_delivery bigint, suggested_target bigint, suggested_weight numeric, composite_score numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_days int; v_weeks numeric;
BEGIN
  v_days := GREATEST((COALESCE(p_deadline, CURRENT_DATE + 90) - CURRENT_DATE)::int, 1);
  v_weeks := v_days::numeric / 7.0;

  RETURN QUERY
  WITH latest_scores AS (
    SELECT DISTINCT ON (ps.playlist_id) ps.playlist_id, ps.capacity_score, ps.health_score, ps.risk_score, ps.delivery_score, ps.metadata
    FROM public.playlist_scores ps ORDER BY ps.playlist_id, ps.calculated_at DESC
  ),
  -- Histórico oficial: agrega vw_campaign_playlist_growth por canonical playlist
  agg_history AS (
    SELECT mp.canonical_playlist_id AS pid,
           COUNT(DISTINCT g.campaign_id)::int AS campaigns_count,
           SUM(g.delivery_accumulated)::bigint AS total_delivered,
           SUM(COALESCE(cea.planned_streams,0))::bigint AS total_promised,
           CASE WHEN SUM(COALESCE(cea.planned_streams,0)) > 0
             THEN SUM(g.delivery_accumulated)::numeric / NULLIF(SUM(cea.planned_streams)::numeric, 0)
             ELSE NULL END AS fulfillment_rate
    FROM public.managed_playlists mp
    JOIN public.vw_campaign_playlist_growth g ON g.playlist_id = mp.spotify_playlist_id
    LEFT JOIN public.campaign_eco_allocations cea
      ON cea.managed_playlist_id = mp.id AND cea.campaign_id = g.campaign_id
    WHERE mp.canonical_playlist_id IS NOT NULL
    GROUP BY mp.canonical_playlist_id
  ),
  candidates AS (
    SELECT p.id AS pid, p.name AS pname, p.followers AS pfollowers, p.cover_url AS pcover,
      COALESCE(ls.capacity_score,0)::numeric AS cap,
      COALESCE(ls.health_score, 50)::numeric AS health,
      COALESCE(ls.risk_score, 0)::numeric AS risk,
      COALESCE(ls.delivery_score, 0)::numeric AS deliv,
      COALESCE(h.campaigns_count, 0) AS h_count,
      h.fulfillment_rate AS h_rate,
      COALESCE(
        NULLIF((ls.metadata->>'avg_weekly_plays')::numeric, 0),
        NULLIF(COALESCE(ls.capacity_score,0)::numeric * 50, 0),
        GREATEST(COALESCE(p.followers, 0)::numeric * 0.0025, 50)
      ) AS weekly_cap
    FROM public.playlists p
    LEFT JOIN latest_scores ls ON ls.playlist_id = p.id
    LEFT JOIN agg_history h ON h.pid = p.id
    WHERE p.ownership = 'own'
      AND (NOT p_exclude_active OR p.id NOT IN (
        SELECT mp.canonical_playlist_id
          FROM public.campaign_eco_allocations cea
          JOIN public.managed_playlists mp ON mp.id = cea.managed_playlist_id
         WHERE cea.status IN ('pending','dispatched','active')
           AND mp.canonical_playlist_id IS NOT NULL
      ))
  ),
  ranked AS (
    SELECT c.*, (c.weekly_cap * v_weeks)::bigint AS expected,
           (0.40*c.cap + 0.25*c.health + 0.20*c.deliv + 0.15*(100-c.risk))::numeric AS composite
    FROM candidates c WHERE c.weekly_cap > 0
    ORDER BY composite DESC, expected DESC LIMIT 20
  ),
  totals AS (SELECT SUM(expected)::numeric AS total_expected FROM ranked)
  SELECT r.pid, r.pname, r.pfollowers, r.pcover, r.cap, r.health, r.risk, r.deliv, r.h_count::int, r.h_rate, r.expected,
    CASE WHEN t.total_expected IS NULL OR t.total_expected = 0 THEN 0::bigint
         ELSE LEAST(r.expected, GREATEST(0, (p_goal::numeric * r.expected / t.total_expected))::bigint) END,
    CASE WHEN t.total_expected IS NULL OR t.total_expected = 0 THEN 1::numeric
         ELSE (r.expected / t.total_expected)::numeric END,
    r.composite
  FROM ranked r CROSS JOIN totals t ORDER BY r.composite DESC;
END;
$function$;

-- 5) evaluate_playlist: histórico vem do motor oficial
CREATE OR REPLACE FUNCTION public.evaluate_playlist(p_spotify_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mp record;
  v_lib record;
  v_canonical uuid;
  v_followers bigint := 0;
  v_genre uuid;
  v_name text;
  v_cover text;
  v_source text := 'unknown';
  v_capacity numeric := 0;
  v_delivery numeric := 0;
  v_health numeric := 0;
  v_risk numeric := 50;
  v_activity numeric := 0;
  v_followers_norm numeric := 0;
  v_score numeric := 0;
  v_recommendation text;
  v_est_plays bigint := 0;
  v_avg_daily numeric := 0;
  v_campaigns_count integer := 0;
  v_fulfillment numeric := 0;
  v_total_delivered bigint := 0;
  v_total_promised bigint := 0;
  v_days_active numeric := 0;
  v_risk_level text;
  v_growth text;
  v_similar jsonb := '[]'::jsonb;
BEGIN
  SELECT mp.id, mp.canonical_playlist_id, mp.followers, mp.genre_id, mp.name, mp.cover_url
    INTO v_mp
  FROM managed_playlists mp
  WHERE mp.spotify_playlist_id = p_spotify_id
  LIMIT 1;

  IF FOUND THEN
    v_source := 'managed';
    v_canonical := v_mp.canonical_playlist_id;
    v_followers := COALESCE(v_mp.followers, 0);
    v_genre := v_mp.genre_id;
    v_name := v_mp.name;
    v_cover := v_mp.cover_url;
  ELSE
    SELECT cl.playlist_name, cl.followers, cl.image_url
      INTO v_lib
    FROM curator_playlist_library cl
    WHERE cl.spotify_playlist_id = p_spotify_id
    LIMIT 1;

    IF FOUND THEN
      v_source := 'external_library';
      v_followers := COALESCE(v_lib.followers, 0);
      v_name := v_lib.playlist_name;
      v_cover := v_lib.image_url;
    ELSE
      RETURN jsonb_build_object(
        'found', false,
        'message', 'Playlist não encontrada no banco. Importe primeiro em Minhas Playlists.'
      );
    END IF;
  END IF;

  IF v_canonical IS NOT NULL THEN
    SELECT
      COALESCE(capacity_score, 0),
      COALESCE(delivery_score, 0),
      COALESCE(health_score, 0),
      COALESCE(risk_score, 50),
      COALESCE(activity_score, 0)
      INTO v_capacity, v_delivery, v_health, v_risk, v_activity
    FROM playlist_scores
    WHERE playlist_id = v_canonical
    LIMIT 1;
  END IF;

  -- Histórico oficial: vw_campaign_playlist_growth + campaign_eco_allocations
  SELECT
    COUNT(DISTINCT g.campaign_id)::int,
    COALESCE(SUM(g.delivery_accumulated), 0)::bigint,
    GREATEST(0, EXTRACT(EPOCH FROM (now() - MIN(COALESCE(g.first_seen_at, g.last_captured_at))))/86400.0)::numeric
  INTO v_campaigns_count, v_total_delivered, v_days_active
  FROM public.vw_campaign_playlist_growth g
  WHERE g.playlist_id = p_spotify_id;

  IF v_mp.id IS NOT NULL THEN
    SELECT COALESCE(SUM(cea.planned_streams), 0)::bigint
      INTO v_total_promised
    FROM public.campaign_eco_allocations cea
    WHERE cea.managed_playlist_id = v_mp.id;
  END IF;

  IF v_days_active > 0 AND v_total_delivered > 0 THEN
    v_avg_daily := v_total_delivered::numeric / v_days_active;
  END IF;
  IF v_total_promised > 0 THEN
    v_fulfillment := v_total_delivered::numeric / v_total_promised::numeric;
  END IF;

  v_followers_norm := LEAST(100, GREATEST(0, log(GREATEST(v_followers, 1) + 1) * 20));

  v_score := ROUND(
    0.30 * v_capacity +
    0.25 * v_delivery +
    0.20 * v_health +
    0.15 * v_followers_norm +
    0.10 * (100 - v_risk)
  );
  v_score := GREATEST(0, LEAST(100, v_score));

  v_recommendation := CASE
    WHEN v_score >= 70 THEN 'buy'
    WHEN v_score >= 40 THEN 'maybe'
    ELSE 'skip'
  END;

  IF v_avg_daily > 0 THEN
    v_est_plays := ROUND(v_avg_daily * 30);
  ELSE
    v_est_plays := ROUND((v_capacity / 100.0) * v_followers * 0.015);
  END IF;

  v_risk_level := CASE
    WHEN v_risk < 30 THEN 'low'
    WHEN v_risk < 60 THEN 'medium'
    ELSE 'high'
  END;

  v_growth := CASE
    WHEN v_followers_norm > v_delivery + 20 THEN 'high'
    WHEN v_followers_norm > v_delivery THEN 'medium'
    ELSE 'low'
  END;

  IF v_canonical IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) INTO v_similar
    FROM (
      SELECT
        mp.id,
        mp.spotify_playlist_id,
        mp.name,
        mp.cover_url,
        mp.followers,
        ROUND(
          0.30 * COALESCE(ps.capacity_score, 0) +
          0.25 * COALESCE(ps.delivery_score, 0) +
          0.20 * COALESCE(ps.health_score, 0) +
          0.15 * LEAST(100, log(GREATEST(mp.followers, 1) + 1) * 20) +
          0.10 * (100 - COALESCE(ps.risk_score, 50))
        ) AS valuation_score
      FROM managed_playlists mp
      LEFT JOIN playlist_scores ps ON ps.playlist_id = mp.canonical_playlist_id
      WHERE mp.spotify_playlist_id <> p_spotify_id
        AND mp.archived_at IS NULL
        AND (v_genre IS NULL OR mp.genre_id = v_genre)
      ORDER BY ABS(
        ROUND(
          0.30 * COALESCE(ps.capacity_score, 0) +
          0.25 * COALESCE(ps.delivery_score, 0) +
          0.20 * COALESCE(ps.health_score, 0) +
          0.15 * LEAST(100, log(GREATEST(mp.followers, 1) + 1) * 20) +
          0.10 * (100 - COALESCE(ps.risk_score, 50))
        ) - v_score
      )
      LIMIT 5
    ) s;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'spotify_playlist_id', p_spotify_id,
    'name', v_name,
    'cover_url', v_cover,
    'followers', v_followers,
    'data_source', v_source,
    'valuation_score', v_score,
    'recommendation', v_recommendation,
    'estimated_monthly_plays', v_est_plays,
    'risk_level', v_risk_level,
    'growth_potential', v_growth,
    'factors', jsonb_build_object(
      'capacity', v_capacity,
      'delivery', v_delivery,
      'health', v_health,
      'risk', v_risk,
      'activity', v_activity,
      'followers_norm', ROUND(v_followers_norm, 1),
      'campaigns_count', v_campaigns_count,
      'fulfillment_rate', ROUND(v_fulfillment, 1),
      'avg_daily_delivery', ROUND(v_avg_daily, 1)
    ),
    'similar_playlists', v_similar
  );
END;
$function$;

-- 6) recalc_playlist_scores: bloco agg_history reescrito
CREATE OR REPLACE FUNCTION public.recalc_playlist_scores()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_count integer; v_cap_ceiling bigint := 50000; v_del_ceiling bigint := 500000;
BEGIN
  WITH
  agg_snapshots AS (
    SELECT cp.canonical_playlist_id AS playlist_id,
           MAX(s.captured_at) AS last_snapshot_at,
           SUM(s.plays_28d) AS plays_28d, SUM(s.plays_7d) AS plays_7d, SUM(s.plays_24h) AS plays_24h
    FROM public.curator_deal_snapshots s
    JOIN public.curator_playlists cp ON cp.id = s.playlist_id
    WHERE cp.canonical_playlist_id IS NOT NULL
      AND COALESCE(cp.is_observational, false) = false
    GROUP BY cp.canonical_playlist_id
  ),
  agg_deals AS (
    SELECT canonical_playlist_id AS playlist_id,
           SUM(streams_total) AS streams_total, SUM(streams_28d) AS streams_28d,
           SUM(streams_7d) AS streams_7d, MAX(added_at) AS last_added_at
    FROM public.curator_playlists
    WHERE canonical_playlist_id IS NOT NULL
      AND COALESCE(is_observational, false) = false
    GROUP BY canonical_playlist_id
  ),
  agg_library AS (
    SELECT canonical_playlist_id AS playlist_id, MAX(times_used) AS times_used, MAX(last_used_at) AS last_used_at
    FROM public.curator_playlist_library WHERE canonical_playlist_id IS NOT NULL GROUP BY canonical_playlist_id
  ),
  agg_managed AS (
    SELECT canonical_playlist_id AS playlist_id,
           MAX(GREATEST(COALESCE(last_metrics_at, '-infinity'::timestamptz),
                        COALESCE(updated_at, '-infinity'::timestamptz))) AS last_managed_activity
    FROM public.managed_playlists WHERE canonical_playlist_id IS NOT NULL AND archived_at IS NULL
    GROUP BY canonical_playlist_id
  ),
  -- Histórico oficial: vw_campaign_playlist_growth + campaign_eco_allocations
  agg_history AS (
    SELECT mp.canonical_playlist_id AS playlist_id,
           COUNT(DISTINCT g.campaign_id)::int AS campaigns_count,
           CASE WHEN SUM(COALESCE(cea.planned_streams,0)) > 0
             THEN SUM(g.delivery_accumulated)::numeric / NULLIF(SUM(cea.planned_streams)::numeric, 0)
             ELSE NULL END AS fulfillment_rate,
           SUM(COALESCE(cea.planned_streams,0))::bigint AS total_promised,
           SUM(g.delivery_accumulated)::bigint AS total_delivered
    FROM public.managed_playlists mp
    JOIN public.vw_campaign_playlist_growth g ON g.playlist_id = mp.spotify_playlist_id
    LEFT JOIN public.campaign_eco_allocations cea
      ON cea.managed_playlist_id = mp.id AND cea.campaign_id = g.campaign_id
    WHERE mp.canonical_playlist_id IS NOT NULL
    GROUP BY mp.canonical_playlist_id
  ),
  combined AS (
    SELECT p.id AS playlist_id,
           COALESCE(s.plays_28d, 0) AS plays_28d, COALESCE(s.plays_7d, 0) AS plays_7d, COALESCE(s.plays_24h, 0) AS plays_24h,
           s.last_snapshot_at,
           COALESCE(d.streams_total, 0) AS streams_total, COALESCE(d.streams_28d, 0) AS streams_28d, COALESCE(d.streams_7d, 0) AS streams_7d,
           GREATEST(COALESCE(l.last_used_at, '-infinity'::timestamptz),
                    COALESCE(m.last_managed_activity, '-infinity'::timestamptz),
                    COALESCE(d.last_added_at, '-infinity'::timestamptz),
                    COALESCE(s.last_snapshot_at, '-infinity'::timestamptz)) AS last_activity_at,
           COALESCE(l.times_used, 0) AS times_used,
           COALESCE(h.campaigns_count, 0) AS campaigns_count,
           h.fulfillment_rate,
           COALESCE(h.total_promised, 0) AS total_promised,
           COALESCE(h.total_delivered, 0) AS total_delivered
    FROM public.playlists p
    LEFT JOIN agg_snapshots s ON s.playlist_id = p.id
    LEFT JOIN agg_deals d ON d.playlist_id = p.id
    LEFT JOIN agg_library l ON l.playlist_id = p.id
    LEFT JOIN agg_managed m ON m.playlist_id = p.id
    LEFT JOIN agg_history h ON h.playlist_id = p.id
  ),
  scored AS (
    SELECT
      playlist_id,
      LEAST(100, GREATEST(0, ROUND(100.0 * ln(1 + GREATEST(plays_28d, streams_28d)) / ln(1 + v_cap_ceiling))))::smallint AS capacity_score,
      LEAST(100, GREATEST(0, ROUND(100.0 * ln(1 + streams_total) / ln(1 + v_del_ceiling))))::smallint AS delivery_observed,
      CASE WHEN campaigns_count < 1 OR fulfillment_rate IS NULL THEN NULL
           ELSE LEAST(100, GREATEST(0, ROUND(LEAST(fulfillment_rate, 1.5) / 1.5 * 100)))::smallint END AS delivery_real,
      CASE
        WHEN last_activity_at = '-infinity'::timestamptz THEN 0::smallint
        WHEN last_activity_at > now() - interval '7 days' THEN 100::smallint
        WHEN last_activity_at > now() - interval '30 days' THEN 75::smallint
        WHEN last_activity_at > now() - interval '90 days' THEN 40::smallint
        ELSE 10::smallint
      END AS activity_score,
      CASE
        WHEN last_activity_at = '-infinity'::timestamptz THEN 90::smallint
        WHEN last_activity_at < now() - interval '90 days' THEN 70::smallint
        WHEN last_activity_at < now() - interval '30 days' THEN 40::smallint
        ELSE 10::smallint
      END AS risk_score,
      plays_28d, plays_7d, plays_24h, streams_total, streams_28d, streams_7d,
      times_used, last_activity_at, last_snapshot_at,
      campaigns_count, fulfillment_rate, total_promised, total_delivered
    FROM combined
  ),
  blended AS (
    SELECT
      playlist_id, capacity_score,
      COALESCE(delivery_real, delivery_observed)::smallint AS delivery_score,
      activity_score, risk_score,
      plays_28d, plays_7d, plays_24h, streams_total, streams_28d, streams_7d,
      times_used, last_activity_at, last_snapshot_at,
      campaigns_count, fulfillment_rate, total_promised, total_delivered,
      delivery_observed, delivery_real
    FROM scored
  ),
  final AS (
    SELECT playlist_id, capacity_score, delivery_score, activity_score, risk_score,
      LEAST(100, GREATEST(0, ROUND(
        0.30 * capacity_score + 0.25 * delivery_score + 0.20 * activity_score + 0.25 * (100 - risk_score)
      )))::smallint AS health_score,
      jsonb_build_object(
        'plays_28d', plays_28d, 'plays_7d', plays_7d, 'plays_24h', plays_24h,
        'streams_total', streams_total, 'streams_28d', streams_28d, 'streams_7d', streams_7d,
        'times_used', times_used, 'last_activity_at', last_activity_at, 'last_snapshot_at', last_snapshot_at,
        'campaigns_count', campaigns_count, 'fulfillment_rate', fulfillment_rate,
        'total_promised', total_promised, 'total_delivered', total_delivered,
        'delivery_observed', delivery_observed, 'delivery_real', delivery_real,
        'source', CASE WHEN delivery_real IS NULL THEN 'snapshots' ELSE 'history+snapshots' END,
        'caps', jsonb_build_object('capacity', v_cap_ceiling, 'delivery', v_del_ceiling)
      ) AS metadata
    FROM blended
  )
  INSERT INTO public.playlist_scores (playlist_id, health_score, delivery_score, capacity_score, risk_score, activity_score, calculated_at, metadata)
  SELECT playlist_id, health_score, delivery_score, capacity_score, risk_score, activity_score, now(), metadata
  FROM final
  ON CONFLICT (playlist_id) DO UPDATE
    SET health_score = EXCLUDED.health_score, delivery_score = EXCLUDED.delivery_score,
        capacity_score = EXCLUDED.capacity_score, risk_score = EXCLUDED.risk_score,
        activity_score = EXCLUDED.activity_score, calculated_at = EXCLUDED.calculated_at,
        metadata = EXCLUDED.metadata;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Realinha campaigns.total_allocated agora pela fonte oficial (uma vez)
UPDATE public.campaigns c
   SET total_allocated = COALESCE(t.s, 0)
  FROM (
    SELECT campaign_id, SUM(planned_streams)::bigint AS s
      FROM public.campaign_eco_allocations
     WHERE status IN ('pending','dispatched','active','done')
     GROUP BY campaign_id
  ) t
 WHERE t.campaign_id = c.id
   AND c.total_allocated IS DISTINCT FROM COALESCE(t.s, 0);
