
CREATE OR REPLACE FUNCTION public.fn_playlist_delivery_accumulated(p_campaign_id uuid)
 RETURNS TABLE(playlist_id text, delivery_accumulated bigint, current_reading bigint, last_reading_at timestamp with time zone, readings_count integer, last_import_delta bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH canon AS MATERIALIZED (
    SELECT canonical_window_days, baseline_captured_at
      FROM public.campaigns WHERE id = p_campaign_id
  ),
  allowed AS MATERIALIZED (
    SELECT ccp.playlist_id AS pid
      FROM public.curator_campaign_playlists ccp
     WHERE ccp.campaign_id = p_campaign_id
       AND COALESCE(ccp.excluded_from_kpis, false) = false
    UNION
    SELECT mp.spotify_playlist_id AS pid
      FROM public.campaign_eco_allocations a
      JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
     WHERE a.campaign_id = p_campaign_id AND mp.spotify_playlist_id IS NOT NULL
    UNION
    SELECT cpc.playlist_id AS pid
      FROM public.campaign_playlist_collections cpc
     WHERE cpc.campaign_id = p_campaign_id
       AND COALESCE(cpc.excluded, false) = false AND cpc.playlist_id IS NOT NULL
    UNION
    SELECT cp.spotify_playlist_id AS pid
      FROM public.curator_playlists cp
      JOIN public.curator_deals cd ON cd.id = cp.deal_id
     WHERE cd.campaign_id = p_campaign_id
       AND cp.spotify_playlist_id IS NOT NULL
       AND COALESCE(cp.is_observational,false)=false
       AND cp.spotify_dead_at IS NULL
  ),
  baseline_ids AS MATERIALIZED (
    SELECT DISTINCT cpc.playlist_id AS pid
      FROM public.campaign_playlist_collections cpc
     WHERE cpc.campaign_id = p_campaign_id
       AND cpc.is_baseline = true AND cpc.playlist_id IS NOT NULL
  ),
  xlsx_readings AS (
    SELECT c.playlist_id AS pid, c.plays_7d, c.captured_at, c.upload_id,
           COALESCE(u.created_at, c.created_at, c.captured_at) AS sequence_at,
           COALESCE(u.window_kind, CASE WHEN c.upload_id IS NULL THEN 'last_7d' ELSE 'unknown' END) AS window_kind
      FROM public.campaign_playlist_collections c
      LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
     WHERE c.campaign_id = p_campaign_id
       AND COALESCE(c.excluded, false) = false
       AND (u.id IS NULL OR u.quarantined_at IS NULL)
       AND c.window_days = (SELECT canonical_window_days FROM canon)
  ),
  paste_readings AS (
    SELECT cp.spotify_playlist_id AS pid,
           COALESCE(cp.streams_7d,0) AS plays_7d,
           cp.last_paste_at AS captured_at,
           NULL::uuid AS upload_id,
           cp.last_paste_at AS sequence_at,
           'last_7d'::text AS window_kind
      FROM public.curator_playlists cp
      JOIN public.curator_deals cd ON cd.id = cp.deal_id
     WHERE cd.campaign_id = p_campaign_id
       AND cp.spotify_playlist_id IS NOT NULL AND cp.last_paste_at IS NOT NULL
       AND COALESCE(cp.is_observational,false)=false AND cp.spotify_dead_at IS NULL
  ),
  zero_seed AS (
    SELECT DISTINCT a.pid,
           0::int AS plays_7d,
           (SELECT baseline_captured_at FROM canon) AS captured_at,
           NULL::uuid AS upload_id,
           (SELECT baseline_captured_at FROM canon) AS sequence_at,
           'last_7d'::text AS window_kind
      FROM allowed a
     WHERE (SELECT baseline_captured_at FROM canon) IS NOT NULL
       AND a.pid NOT IN (SELECT b.pid FROM baseline_ids b)
  ),
  all_readings AS (
    SELECT * FROM xlsx_readings
    UNION ALL SELECT * FROM paste_readings
    UNION ALL SELECT * FROM zero_seed
  ),
  valid AS MATERIALIZED (
    SELECT r.* FROM all_readings r
     WHERE r.pid IN (SELECT a2.pid FROM allowed a2)
  ),
  ordered AS MATERIALIZED (
    SELECT v.pid, v.plays_7d, v.captured_at, v.upload_id, v.window_kind,
           ROW_NUMBER() OVER (PARTITION BY v.pid ORDER BY v.sequence_at, v.captured_at, v.upload_id NULLS FIRST) AS rn,
           LAG(v.plays_7d) OVER (PARTITION BY v.pid ORDER BY v.sequence_at, v.captured_at, v.upload_id NULLS FIRST) AS prev_plays
      FROM valid v
  ),
  with_delta AS MATERIALIZED (
    SELECT o.pid, o.plays_7d, o.captured_at, o.upload_id, o.rn, o.prev_plays, o.window_kind,
           CASE
             WHEN o.rn = 1 THEN 0::bigint
             WHEN o.window_kind IN ('last_24h','last_day') THEN o.plays_7d::bigint
             ELSE GREATEST(0, o.plays_7d - COALESCE(o.prev_plays, o.plays_7d))::bigint
           END AS delta_pos
      FROM ordered o
  ),
  totals AS MATERIALIZED (
    SELECT w.pid, SUM(w.delta_pos)::bigint AS delivery_accumulated,
           COUNT(*)::int AS readings_count, MAX(w.rn) AS max_rn
      FROM with_delta w GROUP BY w.pid
  ),
  last_row AS MATERIALIZED (
    SELECT w.pid, w.plays_7d::bigint AS current_reading, w.captured_at AS last_reading_at,
           CASE
             WHEN w.rn = 1 THEN 0::bigint
             WHEN w.window_kind IN ('last_24h','last_day') THEN w.plays_7d::bigint
             WHEN w.prev_plays IS NULL THEN NULL
             ELSE GREATEST(0, w.plays_7d - w.prev_plays)::bigint
           END AS last_import_delta
      FROM with_delta w
      JOIN totals t ON t.pid = w.pid AND t.max_rn = w.rn
  )
  SELECT t.pid, t.delivery_accumulated, lr.current_reading, lr.last_reading_at, t.readings_count, lr.last_import_delta
    FROM totals t LEFT JOIN last_row lr ON lr.pid = t.pid;
END;
$function$;
