DROP FUNCTION IF EXISTS public.suggest_campaign_playlists(bigint, date, boolean, boolean);

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
END; $function$;