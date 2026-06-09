
-- 1) get_curator_deal_breakdown: ignora observacionais
CREATE OR REPLACE FUNCTION public.get_curator_deal_breakdown(p_deal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_baseline bigint;
  v_target bigint;
  v_result jsonb;
  v_is_service boolean := (current_setting('request.jwt.claim.role', true) = 'service_role')
                          OR (auth.role() = 'service_role');
BEGIN
  SELECT user_id, COALESCE(baseline_plays,0), COALESCE(target_plays,0)
    INTO v_owner, v_baseline, v_target
  FROM public.curator_deals
  WHERE id = p_deal_id;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('error','deal_not_found');
  END IF;

  IF NOT v_is_service
     AND v_owner IS DISTINCT FROM auth.uid()
     AND NOT public.has_team_access() THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (s.playlist_id)
      s.playlist_id, s.plays, s.captured_at
    FROM public.curator_deal_snapshots s
    WHERE s.deal_id = p_deal_id AND s.is_baseline = false
    ORDER BY s.playlist_id, s.captured_at DESC
  ),
  classified AS (
    SELECT l.playlist_id, l.plays, COALESCE(p.match_status, 'organic') AS match_status
    FROM latest l
    JOIN public.curator_playlists p ON p.id = l.playlist_id
    WHERE p.is_baseline = false
      AND COALESCE(p.is_observational, false) = false  -- PATCH: exclui ecossistema interno
  ),
  agg AS (
    SELECT match_status, COUNT(*)::int AS playlists, COALESCE(SUM(plays),0)::bigint AS plays
    FROM classified GROUP BY match_status
  )
  SELECT jsonb_build_object(
    'curator', jsonb_build_object(
      'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='curator'),0),
      'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='curator'),0)
    ),
    'ecosystem', jsonb_build_object(
      'editorial', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='editorial'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='editorial'),0)
      ),
      'algorithmic', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='algorithmic'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='algorithmic'),0)
      ),
      'organic', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='organic'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='organic'),0)
      ),
      'suspicious', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='suspicious'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='suspicious'),0)
      )
    ),
    'total', jsonb_build_object(
      'playlists', COALESCE((SELECT SUM(playlists) FROM agg),0),
      'plays',     COALESCE((SELECT SUM(plays)     FROM agg),0)
    ),
    'baseline_plays', v_baseline,
    'target_plays',   v_target
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- 2) get_curator_deal_progress: ignora observacionais nas duas CTEs curator_pls
CREATE OR REPLACE FUNCTION public.get_curator_deal_progress(p_deal_id uuid, p_song_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_target bigint := 0;
  v_daily_goal bigint := 0;
  v_per_song jsonb := '[]'::jsonb;
BEGIN
  IF p_song_id IS NOT NULL THEN
    SELECT COALESCE(target_plays, 0), COALESCE(daily_goal, 0)
      INTO v_target, v_daily_goal
      FROM public.curator_deal_songs
     WHERE id = p_song_id AND deal_id = p_deal_id;
    IF v_target IS NULL THEN
      SELECT COALESCE(target_plays, 0), COALESCE(daily_goal, 0)
        INTO v_target, v_daily_goal
        FROM public.curator_deals WHERE id = p_deal_id;
    END IF;
  ELSE
    SELECT COALESCE(target_plays, 0), COALESCE(daily_goal, 0)
      INTO v_target, v_daily_goal
      FROM public.curator_deals WHERE id = p_deal_id;
  END IF;

  WITH curator_pls AS (
    SELECT id, attribution_method FROM public.curator_playlists
     WHERE deal_id = p_deal_id AND match_status = 'curator'
       AND COALESCE(is_observational, false) = false  -- PATCH
  ),
  all_snaps AS (
    SELECT s.song_id, s.playlist_id, s.plays, s.captured_at, s.is_baseline,
           cp.attribution_method
      FROM public.curator_deal_snapshots s
      JOIN curator_pls cp ON cp.id = s.playlist_id
     WHERE s.deal_id = p_deal_id
  ),
  baseline_pp AS (
    SELECT song_id, playlist_id,
           CASE
             WHEN MAX(attribution_method) IN ('late_discovery_zero', 'manual_zero') THEN 0
             ELSE COALESCE(
               (SELECT plays FROM all_snaps s2
                 WHERE s2.song_id IS NOT DISTINCT FROM a.song_id
                   AND s2.playlist_id = a.playlist_id AND s2.is_baseline
                 ORDER BY captured_at ASC LIMIT 1),
               (SELECT plays FROM all_snaps s3
                 WHERE s3.song_id IS NOT DISTINCT FROM a.song_id
                   AND s3.playlist_id = a.playlist_id
                 ORDER BY captured_at ASC LIMIT 1)
             )
           END AS baseline_plays
      FROM all_snaps a
     GROUP BY song_id, playlist_id
  ),
  latest_pp AS (
    SELECT DISTINCT ON (song_id, playlist_id)
           song_id, playlist_id, plays AS latest_plays, captured_at AS last_captured_at
      FROM all_snaps
     ORDER BY song_id, playlist_id, captured_at DESC
  ),
  per_song_playlist AS (
    SELECT b.song_id, b.playlist_id,
           b.baseline_plays, l.latest_plays, l.last_captured_at,
           GREATEST(COALESCE(l.latest_plays,0) - COALESCE(b.baseline_plays,0), 0) AS delivered
      FROM baseline_pp b
      LEFT JOIN latest_pp l ON l.song_id IS NOT DISTINCT FROM b.song_id AND l.playlist_id = b.playlist_id
  ),
  per_song AS (
    SELECT song_id,
      COALESCE(SUM(delivered), 0) AS delivered_curator,
      COALESCE(SUM(baseline_plays), 0) AS baseline_curator,
      COALESCE(SUM(latest_plays), 0) AS latest_curator,
      MIN(last_captured_at) AS first_capture_at,
      MAX(last_captured_at) AS last_capture_at
    FROM per_song_playlist
    GROUP BY song_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'song_id', ps.song_id,
    'target_plays', COALESCE(cds.target_plays, 0),
    'daily_goal', COALESCE(cds.daily_goal, 0),
    'baseline_total', ps.baseline_curator,
    'latest_total', ps.latest_curator,
    'delivered_curator', ps.delivered_curator,
    'first_capture_at', ps.first_capture_at,
    'last_capture_at', ps.last_capture_at,
    'progress_pct', CASE
      WHEN COALESCE(cds.target_plays,0) <= 0 THEN 0
      ELSE LEAST(100, ROUND((ps.delivered_curator::numeric / cds.target_plays::numeric) * 100, 1))
    END
  )), '[]'::jsonb)
  INTO v_per_song
  FROM per_song ps
  LEFT JOIN public.curator_deal_songs cds ON cds.id = ps.song_id;

  WITH curator_pls AS (
    SELECT id, attribution_method FROM public.curator_playlists
     WHERE deal_id = p_deal_id AND match_status = 'curator'
       AND COALESCE(is_observational, false) = false  -- PATCH
  ),
  snaps AS (
    SELECT s.playlist_id, s.plays, s.captured_at, s.is_baseline,
           cp.attribution_method
      FROM public.curator_deal_snapshots s
      JOIN curator_pls cp ON cp.id = s.playlist_id
     WHERE s.deal_id = p_deal_id
       AND (p_song_id IS NULL OR s.song_id = p_song_id)
  ),
  baseline_per_playlist AS (
    SELECT playlist_id,
           CASE
             WHEN MAX(attribution_method) IN ('late_discovery_zero', 'manual_zero') THEN 0
             ELSE COALESCE(
               (SELECT plays FROM snaps s2
                 WHERE s2.playlist_id = s.playlist_id AND s2.is_baseline
                 ORDER BY captured_at ASC LIMIT 1),
               (SELECT plays FROM snaps s3
                 WHERE s3.playlist_id = s.playlist_id
                 ORDER BY captured_at ASC LIMIT 1)
             )
           END AS baseline_plays,
           COALESCE(
             (SELECT captured_at FROM snaps s2
               WHERE s2.playlist_id = s.playlist_id AND s2.is_baseline
               ORDER BY captured_at ASC LIMIT 1),
             (SELECT captured_at FROM snaps s3
               WHERE s3.playlist_id = s.playlist_id
               ORDER BY captured_at ASC LIMIT 1)
           ) AS baseline_at,
           MAX(attribution_method) AS attribution_method
      FROM snaps s
     GROUP BY playlist_id
  ),
  latest_per_playlist AS (
    SELECT DISTINCT ON (playlist_id)
           playlist_id, plays AS latest_plays, captured_at AS last_captured_at
      FROM snaps
     ORDER BY playlist_id, captured_at DESC
  ),
  per_playlist AS (
    SELECT b.playlist_id, cp.playlist_name, cp.is_baseline AS playlist_is_baseline,
           b.baseline_plays, b.baseline_at, l.latest_plays, l.last_captured_at,
           b.attribution_method,
           GREATEST(COALESCE(l.latest_plays,0) - COALESCE(b.baseline_plays,0), 0) AS delivered,
           (SELECT COUNT(*) FROM snaps s WHERE s.playlist_id = b.playlist_id AND s.captured_at > b.baseline_at)::int AS snapshot_count
    FROM baseline_per_playlist b
    LEFT JOIN latest_per_playlist l ON l.playlist_id = b.playlist_id
    LEFT JOIN public.curator_playlists cp ON cp.id = b.playlist_id
  ),
  totals AS (
    SELECT
      COALESCE(SUM(delivered), 0) AS delivered_curator,
      COALESCE(SUM(delivered), 0) AS delivered_total,
      COALESCE(SUM(baseline_plays), 0) AS baseline_curator,
      COALESCE(SUM(latest_plays), 0) AS latest_curator
    FROM per_playlist
  ),
  range_info AS (
    SELECT MIN(captured_at) AS first_capture, MAX(captured_at) AS last_capture FROM snaps
  )
  SELECT jsonb_build_object(
    'deal_id', p_deal_id,
    'song_id', p_song_id,
    'target_plays', v_target,
    'daily_goal', v_daily_goal,
    'baseline_total', t.baseline_curator,
    'latest_total', t.latest_curator,
    'delivered_curator', t.delivered_curator,
    'delivered_total', t.delivered_total,
    'first_capture_at', r.first_capture,
    'last_capture_at', r.last_capture,
    'days_elapsed', CASE
      WHEN r.first_capture IS NULL OR r.last_capture IS NULL THEN 0
      ELSE GREATEST(EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) / 86400.0, 0)
    END,
    'daily_avg', CASE
      WHEN r.first_capture IS NULL OR r.last_capture IS NULL
        OR EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) <= 0 THEN 0
      ELSE t.delivered_curator / (EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) / 86400.0)
    END,
    'progress_pct', CASE
      WHEN v_target <= 0 THEN 0
      ELSE LEAST(100, ROUND((t.delivered_curator::numeric / v_target::numeric) * 100, 1))
    END,
    'eta_days', CASE
      WHEN v_target <= 0 OR t.delivered_curator >= v_target THEN 0
      WHEN r.first_capture IS NULL OR r.last_capture IS NULL
        OR EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) <= 0 THEN NULL
      ELSE CEIL(
        (v_target - t.delivered_curator)::numeric
        / NULLIF(t.delivered_curator / (EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) / 86400.0), 0)
      )
    END,
    'per_playlist', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'playlist_id', pp.playlist_id,
        'playlist_name', pp.playlist_name,
        'is_baseline', pp.playlist_is_baseline,
        'attribution_method', pp.attribution_method,
        'baseline_plays', pp.baseline_plays,
        'latest_plays', pp.latest_plays,
        'delivered', pp.delivered,
        'last_captured_at', pp.last_captured_at,
        'snapshot_count', pp.snapshot_count
      ) ORDER BY pp.delivered DESC) FROM per_playlist pp),
      '[]'::jsonb
    ),
    'delivered_per_song', v_per_song
  )
  INTO v_result
  FROM totals t CROSS JOIN range_info r;

  RETURN COALESCE(v_result, jsonb_build_object(
    'deal_id', p_deal_id,
    'song_id', p_song_id,
    'target_plays', v_target,
    'daily_goal', v_daily_goal,
    'baseline_total', 0, 'latest_total', 0,
    'delivered_curator', 0, 'delivered_total', 0,
    'daily_avg', 0, 'days_elapsed', 0,
    'progress_pct', 0, 'eta_days', NULL,
    'per_playlist', '[]'::jsonb,
    'delivered_per_song', v_per_song
  ));
END;
$function$;

-- 3) recompute_curator_deal_state: ignora observacionais
CREATE OR REPLACE FUNCTION public.recompute_curator_deal_state(p_deal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_closed_at timestamptz;
  v_closed_status text;
  v_has_curator_pl boolean;
  v_has_snapshot boolean;
  v_new_state text;
  v_old_state text;
BEGIN
  SELECT closed_at, closed_status, state INTO v_closed_at, v_closed_status, v_old_state
    FROM public.curator_deals WHERE id = p_deal_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_closed_at IS NOT NULL THEN
    v_new_state := CASE WHEN v_closed_status = 'completed' THEN 'completed' ELSE 'closed' END;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM public.curator_playlists
       WHERE deal_id = p_deal_id AND match_status = 'curator'
         AND COALESCE(is_observational, false) = false  -- PATCH
    ) INTO v_has_curator_pl;

    IF NOT v_has_curator_pl THEN
      v_new_state := 'awaiting_playlists';
    ELSE
      SELECT EXISTS(
        SELECT 1 FROM public.curator_deal_snapshots s
         JOIN public.curator_playlists p ON p.id = s.playlist_id
         WHERE s.deal_id = p_deal_id
           AND p.match_status = 'curator'
           AND COALESCE(p.is_observational, false) = false  -- PATCH
           AND s.is_baseline = false
      ) INTO v_has_snapshot;
      v_new_state := CASE WHEN v_has_snapshot THEN 'active' ELSE 'collecting' END;
    END IF;
  END IF;

  UPDATE public.curator_deals
     SET state = v_new_state
   WHERE id = p_deal_id AND state IS DISTINCT FROM v_new_state
     AND state <> 'paused';

  IF v_new_state = 'collecting' AND v_old_state IS DISTINCT FROM 'collecting' THEN
    UPDATE public.curator_deal_songs
       SET next_auto_collect_at = now()
     WHERE deal_id = p_deal_id
       AND auto_collect = true
       AND auto_collect_status IN ('idle', 'error')
       AND (next_auto_collect_at IS NULL OR next_auto_collect_at > now());
  END IF;
END;
$function$;

-- 4) recalc_campaign_progress: ignora observacionais
CREATE OR REPLACE FUNCTION public.recalc_campaign_progress(p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count int := 0; v_camp record;
BEGIN
  FOR v_camp IN
    SELECT id, started_at FROM public.campaigns
     WHERE (p_campaign_id IS NULL OR id = p_campaign_id)
       AND (p_campaign_id IS NOT NULL OR status = 'active')
  LOOP
    UPDATE public.campaign_allocations ca
       SET delivered_plays = COALESCE(sub.plays_delta, 0)
      FROM (
        SELECT ca2.id AS alloc_id,
          GREATEST(0, COALESCE(MAX(s.plays),0) - COALESCE(MIN(s.plays),0))::bigint AS plays_delta
        FROM public.campaign_allocations ca2
        LEFT JOIN public.curator_playlists cp
               ON cp.canonical_playlist_id = ca2.playlist_id
              AND COALESCE(cp.is_observational, false) = false  -- PATCH
        LEFT JOIN public.curator_deal_snapshots s ON s.playlist_id = cp.id AND s.captured_at >= v_camp.started_at
        WHERE ca2.campaign_id = v_camp.id
        GROUP BY ca2.id
      ) sub
     WHERE ca.id = sub.alloc_id;

    UPDATE public.campaigns
       SET total_delivered = COALESCE((SELECT SUM(delivered_plays) FROM public.campaign_allocations WHERE campaign_id = v_camp.id), 0)
     WHERE id = v_camp.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $function$;

-- 5) recalc_playlist_scores: ignora observacionais nas duas CTEs (snapshots + deals)
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
      AND COALESCE(cp.is_observational, false) = false  -- PATCH
    GROUP BY cp.canonical_playlist_id
  ),
  agg_deals AS (
    SELECT canonical_playlist_id AS playlist_id,
           SUM(streams_total) AS streams_total, SUM(streams_28d) AS streams_28d,
           SUM(streams_7d) AS streams_7d, MAX(added_at) AS last_added_at
    FROM public.curator_playlists
    WHERE canonical_playlist_id IS NOT NULL
      AND COALESCE(is_observational, false) = false  -- PATCH
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
  agg_history AS (
    SELECT playlist_id, campaigns_count, fulfillment_rate, total_promised, total_delivered
    FROM public.v_playlist_delivery_history
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
        WHEN last_activity_at = '-infinity'::timestamptz THEN 0
        WHEN last_activity_at > now() - interval '7 days' THEN 100
        WHEN last_activity_at < now() - interval '90 days' THEN 0
        ELSE GREATEST(0, LEAST(100, ROUND(100.0 * (1 - EXTRACT(EPOCH FROM (now() - last_activity_at)) / EXTRACT(EPOCH FROM interval '90 days')))))::smallint
      END::smallint AS activity_score,
      CASE WHEN plays_28d <= 0 THEN 0
           ELSE LEAST(100, GREATEST(0, ROUND(100.0 * ABS(4.0 * plays_7d - plays_28d) / NULLIF(plays_28d, 0))))::smallint
      END::smallint AS risk_score,
      plays_28d, plays_7d, plays_24h, streams_total, streams_28d, streams_7d,
      times_used, last_activity_at, last_snapshot_at,
      campaigns_count, fulfillment_rate, total_promised, total_delivered
    FROM combined
  ),
  blended AS (
    SELECT playlist_id, capacity_score,
      CASE WHEN delivery_real IS NULL THEN delivery_observed
           ELSE LEAST(100, GREATEST(0, ROUND(0.6 * delivery_real + 0.4 * delivery_observed)))::smallint END AS delivery_score,
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

-- 6) View: curator_playlist_library_stats → lê da view operacional
DROP VIEW IF EXISTS public.curator_playlist_library_stats CASCADE;
CREATE VIEW public.curator_playlist_library_stats AS
SELECT lib.id AS library_id,
       lib.curator_id,
       lib.user_id,
       lib.spotify_url,
       lib.playlist_name,
       lib.followers,
       lib.image_url,
       lib.status,
       lib.last_used_at,
       count(DISTINCT p.deal_id) AS deals_count,
       COALESCE(sum(p.streams_7d), (0)::numeric) AS total_streams_7d,
       COALESCE(sum(p.streams_total), (0)::numeric) AS total_streams_lifetime,
       CASE
         WHEN (count(DISTINCT p.deal_id) > 0)
           THEN round((sum(p.streams_7d) / (count(DISTINCT p.deal_id))::numeric), 0)
         ELSE (0)::numeric
       END AS avg_streams_per_deal
  FROM ((public.curator_playlist_library lib
    LEFT JOIN public.curator_deals d ON ((d.curator_id = lib.curator_id)))
    LEFT JOIN public.v_curator_playlists_operational p
      ON (((p.deal_id = d.id)
        AND (((lib.spotify_playlist_id IS NOT NULL) AND (public.extract_spotify_playlist_id(p.spotify_url) = lib.spotify_playlist_id))
          OR ((lib.spotify_playlist_id IS NULL) AND (lower(TRIM(BOTH FROM p.playlist_name)) = lower(TRIM(BOTH FROM lib.playlist_name))))))))
 GROUP BY lib.id, lib.curator_id, lib.user_id, lib.spotify_url, lib.playlist_name, lib.followers, lib.image_url, lib.status, lib.last_used_at;

GRANT SELECT ON public.curator_playlist_library_stats TO authenticated;
GRANT ALL ON public.curator_playlist_library_stats TO service_role;

-- 7) View: curator_playlist_performance → lê da view operacional
DROP VIEW IF EXISTS public.curator_playlist_performance CASCADE;
CREATE VIEW public.curator_playlist_performance AS
WITH playlist_deal_stats AS (
  SELECT lib.id AS library_id,
         lib.curator_id,
         lib.user_id,
         lib.spotify_playlist_id,
         lib.playlist_name,
         cp.deal_id,
         max(cp.streams_7d) AS streams_7d,
         max(cp.streams_total) AS streams_total
    FROM public.curator_playlist_library lib
    LEFT JOIN public.v_curator_playlists_operational cp
      ON (((((lib.spotify_playlist_id IS NOT NULL) AND (cp.spotify_playlist_id = lib.spotify_playlist_id))
        OR ((lib.spotify_playlist_id IS NULL) AND (lower(TRIM(BOTH FROM cp.playlist_name)) = lower(TRIM(BOTH FROM lib.playlist_name)))))
        AND (cp.deal_id IN ( SELECT curator_deals.id FROM public.curator_deals WHERE (curator_deals.curator_id = lib.curator_id)))
        AND (cp.is_baseline = false)))
   GROUP BY lib.id, lib.curator_id, lib.user_id, lib.spotify_playlist_id, lib.playlist_name, cp.deal_id
), agg AS (
  SELECT library_id, curator_id, user_id,
         count(deal_id) FILTER (WHERE (deal_id IS NOT NULL)) AS deals_count,
         COALESCE(sum(streams_7d), (0)::numeric) AS total_streams_7d,
         COALESCE(sum(streams_total), (0)::numeric) AS total_streams_lifetime,
         COALESCE(avg(NULLIF(streams_7d, 0)), (0)::numeric) AS avg_streams_7d,
         COALESCE(max(streams_7d), (0)::bigint) AS best_streams_7d,
         COALESCE(min(NULLIF(streams_7d, 0)), (0)::bigint) AS worst_streams_7d,
         COALESCE(stddev_pop(NULLIF(streams_7d, 0)), (0)::numeric) AS stddev_streams_7d
    FROM playlist_deal_stats
   GROUP BY library_id, curator_id, user_id
)
SELECT library_id, curator_id, user_id, deals_count, total_streams_7d, total_streams_lifetime,
       (round(avg_streams_7d))::bigint AS avg_streams_7d,
       best_streams_7d, worst_streams_7d,
       CASE WHEN (avg_streams_7d > (0)::numeric) THEN round((stddev_streams_7d / avg_streams_7d), 2) ELSE (0)::numeric END AS variation_coef,
       CASE WHEN (best_streams_7d > 0) THEN round((((best_streams_7d - worst_streams_7d))::numeric / (best_streams_7d)::numeric), 2) ELSE (0)::numeric END AS drop_ratio,
       CASE
         WHEN (deals_count = 0) THEN 'sem_historico'::text
         WHEN (deals_count = 1) THEN 'novo'::text
         WHEN ((avg_streams_7d > (0)::numeric) AND ((stddev_streams_7d / avg_streams_7d) > 1.5) AND (best_streams_7d > 0) AND ((((best_streams_7d - worst_streams_7d))::numeric / (best_streams_7d)::numeric) > 0.8)) THEN 'suspeita'::text
         WHEN ((deals_count >= 3) AND (avg_streams_7d > (500)::numeric) AND (avg_streams_7d > (0)::numeric) AND ((stddev_streams_7d / avg_streams_7d) < 0.5)) THEN 'excelente'::text
         WHEN ((avg_streams_7d > (200)::numeric) AND ((avg_streams_7d = (0)::numeric) OR ((stddev_streams_7d / avg_streams_7d) < 1.0))) THEN 'boa'::text
         WHEN (avg_streams_7d < (100)::numeric) THEN 'fraca'::text
         ELSE 'media'::text
       END AS performance_class
  FROM agg a;

GRANT SELECT ON public.curator_playlist_performance TO authenticated;
GRANT ALL ON public.curator_playlist_performance TO service_role;
