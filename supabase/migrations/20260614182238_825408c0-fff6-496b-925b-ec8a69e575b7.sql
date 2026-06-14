CREATE OR REPLACE FUNCTION public.fn_playlist_delivery_accumulated(p_campaign_id uuid)
 RETURNS TABLE(playlist_id text, delivery_accumulated bigint, current_reading bigint, last_reading_at timestamp with time zone, readings_count integer, last_import_delta bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH canon AS MATERIALIZED (
    SELECT canonical_window_days FROM public.campaigns WHERE id = p_campaign_id
  ),
  allowed AS MATERIALIZED (
    SELECT ccp.playlist_id FROM public.curator_campaign_playlists ccp
     WHERE ccp.campaign_id = p_campaign_id
       AND COALESCE(ccp.excluded_from_kpis, false) = false
    UNION
    SELECT mp.spotify_playlist_id
      FROM public.campaign_eco_allocations a
      JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
     WHERE a.campaign_id = p_campaign_id
       AND mp.spotify_playlist_id IS NOT NULL
    UNION
    SELECT bp.spotify_playlist_id
      FROM public.curator_deal_baseline_playlists bp
      JOIN public.curator_deals d ON d.id = bp.deal_id
     WHERE d.campaign_id = p_campaign_id
       AND bp.spotify_playlist_id IS NOT NULL
  ),
  valid AS MATERIALIZED (
    SELECT c.playlist_id, c.plays_7d, c.is_baseline, c.captured_at,
           COALESCE(u.created_at, c.created_at) AS up_created
      FROM public.campaign_playlist_collections c
      LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
     WHERE c.campaign_id = p_campaign_id
       AND COALESCE(c.excluded, false) = false
       AND (u.id IS NULL OR u.quarantined_at IS NULL)
       AND c.window_days = (SELECT canonical_window_days FROM canon)
       AND (c.is_baseline = true OR c.playlist_id IN (SELECT a2.playlist_id FROM allowed a2))
  ),
  has_baseline AS MATERIALIZED (
    SELECT v.playlist_id, BOOL_OR(v.is_baseline) AS has_bl
      FROM valid v GROUP BY v.playlist_id
  ),
  ordered AS MATERIALIZED (
    SELECT v.playlist_id, v.plays_7d, v.captured_at, hb.has_bl,
           ROW_NUMBER() OVER (PARTITION BY v.playlist_id ORDER BY v.up_created, v.captured_at) AS rn,
           LAG(v.plays_7d) OVER (PARTITION BY v.playlist_id ORDER BY v.up_created, v.captured_at) AS prev_plays
      FROM valid v
      JOIN has_baseline hb USING (playlist_id)
  ),
  with_delta AS MATERIALIZED (
    SELECT o.playlist_id, o.plays_7d, o.captured_at, o.rn, o.prev_plays, o.has_bl,
           CASE
             WHEN o.rn = 1 AND o.has_bl     THEN 0::bigint
             WHEN o.rn = 1 AND NOT o.has_bl THEN o.plays_7d::bigint
             ELSE GREATEST(0, o.plays_7d - COALESCE(o.prev_plays, o.plays_7d))::bigint
           END AS delta_pos
      FROM ordered o
  ),
  totals AS MATERIALIZED (
    SELECT w.playlist_id,
           SUM(w.delta_pos)::bigint AS delivery_accumulated,
           MAX(w.plays_7d)::bigint  AS current_reading,
           MAX(w.captured_at)       AS last_reading_at,
           COUNT(*)::int            AS readings_count,
           MAX(w.rn)                AS max_rn
      FROM with_delta w GROUP BY w.playlist_id
  ),
  last_row AS MATERIALIZED (
    SELECT w.playlist_id,
           CASE
             WHEN w.rn = 1 AND NOT w.has_bl THEN w.plays_7d::bigint
             WHEN w.prev_plays IS NULL      THEN NULL
             ELSE GREATEST(0, w.plays_7d - w.prev_plays)::bigint
           END AS last_import_delta
      FROM with_delta w
      JOIN totals t ON t.playlist_id = w.playlist_id AND t.max_rn = w.rn
  )
  SELECT t.playlist_id,
         t.delivery_accumulated,
         t.current_reading,
         t.last_reading_at,
         t.readings_count,
         lr.last_import_delta
    FROM totals t
    LEFT JOIN last_row lr ON lr.playlist_id = t.playlist_id;
END;
$function$;