
CREATE OR REPLACE VIEW public.v_playlist_delivery_history
WITH (security_invoker = on) AS
WITH base AS (
  SELECT ca.playlist_id, ca.target_plays, ca.delivered_plays,
         c.id AS campaign_id, c.started_at, c.deadline, c.status
  FROM public.campaign_allocations ca
  JOIN public.campaigns c ON c.id = ca.campaign_id
  WHERE c.status IN ('active','paused','completed')
)
SELECT
  playlist_id,
  COUNT(DISTINCT campaign_id)::int AS campaigns_count,
  SUM(target_plays)::bigint AS total_promised,
  SUM(delivered_plays)::bigint AS total_delivered,
  CASE WHEN SUM(target_plays) > 0
       THEN (SUM(delivered_plays)::numeric / SUM(target_plays)::numeric)
       ELSE NULL END AS fulfillment_rate,
  CASE WHEN SUM(GREATEST(1, (LEAST(CURRENT_DATE, deadline) - started_at::date))) > 0
       THEN (SUM(delivered_plays)::numeric / SUM(GREATEST(1, (LEAST(CURRENT_DATE, deadline) - started_at::date)))::numeric)
       ELSE 0 END AS avg_daily_delivery,
  MAX(started_at) AS last_campaign_at
FROM base GROUP BY playlist_id;
GRANT SELECT ON public.v_playlist_delivery_history TO authenticated;

CREATE OR REPLACE VIEW public.v_campaign_velocity
WITH (security_invoker = on) AS
SELECT
  c.id AS campaign_id, c.track_name, c.status, c.goal_plays, c.total_delivered,
  c.started_at, c.deadline,
  GREATEST(1, (CURRENT_DATE - c.started_at::date))::int AS days_elapsed,
  GREATEST(1, (c.deadline - c.started_at::date))::int AS days_total,
  CASE WHEN (CURRENT_DATE - c.started_at::date) > 0
       THEN (c.total_delivered::numeric / GREATEST(1,(CURRENT_DATE - c.started_at::date))::numeric)
       ELSE 0 END AS delivered_per_day,
  CASE
    WHEN c.goal_plays = 0 OR (c.deadline - c.started_at::date) <= 0 THEN NULL
    ELSE c.total_delivered::numeric
         / NULLIF((c.goal_plays::numeric * LEAST(1.0, (CURRENT_DATE - c.started_at::date)::numeric / GREATEST(1,(c.deadline - c.started_at::date))::numeric)), 0)
  END AS pace_ratio
FROM public.campaigns c;
GRANT SELECT ON public.v_campaign_velocity TO authenticated;

CREATE OR REPLACE FUNCTION public.recalc_playlist_scores()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    GROUP BY cp.canonical_playlist_id
  ),
  agg_deals AS (
    SELECT canonical_playlist_id AS playlist_id,
           SUM(streams_total) AS streams_total, SUM(streams_28d) AS streams_28d,
           SUM(streams_7d) AS streams_7d, MAX(added_at) AS last_added_at
    FROM public.curator_playlists WHERE canonical_playlist_id IS NOT NULL GROUP BY canonical_playlist_id
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

DROP FUNCTION IF EXISTS public.suggest_campaign_playlists(bigint, date, boolean);

CREATE OR REPLACE FUNCTION public.suggest_campaign_playlists(
  p_goal bigint, p_deadline date, p_exclude_active boolean DEFAULT true
) RETURNS TABLE (
  playlist_id uuid, playlist_name text, followers bigint, cover_url text,
  capacity_score numeric, health_score numeric, risk_score numeric,
  delivery_score numeric, campaigns_count integer, fulfillment_rate numeric,
  expected_delivery bigint, suggested_target bigint, suggested_weight numeric, composite_score numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_days int; v_weeks numeric;
BEGIN
  v_days := GREATEST((p_deadline - CURRENT_DATE)::int, 1);
  v_weeks := v_days::numeric / 7.0;

  RETURN QUERY
  WITH latest_scores AS (
    SELECT DISTINCT ON (ps.playlist_id) ps.playlist_id, ps.capacity_score, ps.health_score, ps.risk_score, ps.delivery_score, ps.metadata
    FROM public.playlist_scores ps ORDER BY ps.playlist_id, ps.calculated_at DESC
  ),
  candidates AS (
    SELECT p.id AS pid, p.name AS pname, p.followers AS pfollowers, p.cover_url AS pcover,
      COALESCE(ls.capacity_score,0)::numeric AS cap,
      COALESCE(ls.health_score,0)::numeric AS health,
      COALESCE(ls.risk_score,0)::numeric AS risk,
      COALESCE(ls.delivery_score,0)::numeric AS deliv,
      COALESCE(h.campaigns_count, 0) AS h_count,
      h.fulfillment_rate AS h_rate,
      COALESCE(NULLIF((ls.metadata->>'avg_weekly_plays')::numeric,0), COALESCE(ls.capacity_score,0)::numeric * 50) AS weekly_cap
    FROM public.playlists p
    LEFT JOIN latest_scores ls ON ls.playlist_id = p.id
    LEFT JOIN public.v_playlist_delivery_history h ON h.playlist_id = p.id
    WHERE p.ownership = 'own'
      AND (NOT p_exclude_active OR p.id NOT IN (
        SELECT ca.playlist_id FROM public.campaign_allocations ca WHERE ca.status IN ('approved','active')
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
END; $$;

GRANT EXECUTE ON FUNCTION public.suggest_campaign_playlists(bigint, date, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_campaign_analytics_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_totals jsonb; v_top jsonb; v_bottom jsonb; v_status_over_time jsonb; v_cost_per_play numeric;
BEGIN
  SELECT jsonb_build_object(
    'total_campaigns', COUNT(*)::int,
    'active_campaigns', COUNT(*) FILTER (WHERE status='active')::int,
    'completed_campaigns', COUNT(*) FILTER (WHERE status='completed')::int,
    'draft_campaigns', COUNT(*) FILTER (WHERE status='draft')::int,
    'paused_campaigns', COUNT(*) FILTER (WHERE status='paused')::int,
    'total_promised', COALESCE(SUM(total_allocated),0)::bigint,
    'total_delivered', COALESCE(SUM(total_delivered),0)::bigint,
    'avg_fulfillment_rate', CASE WHEN SUM(total_allocated) > 0
      THEN (SUM(total_delivered)::numeric / SUM(total_allocated)::numeric) ELSE NULL END
  ) INTO v_totals FROM public.campaigns;

  SELECT jsonb_agg(t) INTO v_top FROM (
    SELECT h.playlist_id, p.name AS playlist_name, p.cover_url,
           h.campaigns_count, h.total_promised, h.total_delivered, h.fulfillment_rate, h.avg_daily_delivery
    FROM public.v_playlist_delivery_history h
    JOIN public.playlists p ON p.id = h.playlist_id
    WHERE h.campaigns_count >= 1 AND h.fulfillment_rate IS NOT NULL
    ORDER BY h.fulfillment_rate DESC, h.total_delivered DESC LIMIT 10
  ) t;

  SELECT jsonb_agg(t) INTO v_bottom FROM (
    SELECT h.playlist_id, p.name AS playlist_name, p.cover_url,
           h.campaigns_count, h.total_promised, h.total_delivered, h.fulfillment_rate, h.avg_daily_delivery
    FROM public.v_playlist_delivery_history h
    JOIN public.playlists p ON p.id = h.playlist_id
    WHERE h.campaigns_count >= 1 AND h.fulfillment_rate IS NOT NULL
    ORDER BY h.fulfillment_rate ASC, h.total_delivered ASC LIMIT 10
  ) t;

  SELECT jsonb_agg(t ORDER BY month) INTO v_status_over_time FROM (
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, status, COUNT(*)::int AS count
    FROM public.campaigns WHERE created_at >= now() - interval '12 months'
    GROUP BY 1, 2
  ) t;

  SELECT CASE WHEN COALESCE(plays.delta,0) > 0 AND COALESCE(spend.amt,0) > 0
              THEN (spend.amt / plays.delta::numeric) ELSE NULL END
  INTO v_cost_per_play
  FROM (SELECT SUM(amount) AS amt FROM public.curator_purchases) spend,
       (SELECT GREATEST(0, SUM(plays))::bigint AS delta FROM public.curator_deal_snapshots WHERE is_baseline = false) plays;

  RETURN jsonb_build_object(
    'totals', v_totals,
    'top_performers', COALESCE(v_top, '[]'::jsonb),
    'bottom_performers', COALESCE(v_bottom, '[]'::jsonb),
    'campaigns_by_status_over_time', COALESCE(v_status_over_time, '[]'::jsonb),
    'cost_per_play', v_cost_per_play,
    'generated_at', now()
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_campaign_analytics_overview() TO authenticated;
