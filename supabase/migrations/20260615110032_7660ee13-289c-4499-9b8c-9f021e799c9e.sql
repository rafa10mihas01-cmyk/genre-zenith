CREATE OR REPLACE FUNCTION public.fn_deal_delivery_accumulated(p_deal_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH deal AS (
    SELECT id, campaign_id, curator_id, COALESCE(reconciled_total_plays, 0)::bigint AS stored_total
    FROM public.curator_deals
    WHERE id = p_deal_id
  ), engine AS (
    SELECT COALESCE(SUM(c.delivery_accumulated), 0)::bigint AS delivered
    FROM deal d
    JOIN public.fn_curator_delivery_accumulated(d.campaign_id) c
      ON c.curator_id = d.curator_id
    WHERE d.campaign_id IS NOT NULL
  ), snapshot_playlists AS (
    SELECT s.song_id, s.playlist_id, s.plays, s.captured_at, s.is_baseline, cp.attribution_method
    FROM public.curator_deal_snapshots s
    JOIN public.curator_playlists cp ON cp.id = s.playlist_id
    WHERE s.deal_id = p_deal_id
      AND cp.deal_id = p_deal_id
      AND cp.match_status = 'curator'
      AND COALESCE(cp.is_observational, false) = false
  ), baseline_pp AS (
    SELECT song_id, playlist_id,
           CASE
             WHEN MAX(attribution_method) IN ('late_discovery_zero', 'manual_zero') THEN 0
             ELSE COALESCE(
               (SELECT sp2.plays FROM snapshot_playlists sp2
                WHERE sp2.song_id IS NOT DISTINCT FROM sp.song_id
                  AND sp2.playlist_id = sp.playlist_id
                  AND sp2.is_baseline
                ORDER BY sp2.captured_at ASC
                LIMIT 1),
               (SELECT sp3.plays FROM snapshot_playlists sp3
                WHERE sp3.song_id IS NOT DISTINCT FROM sp.song_id
                  AND sp3.playlist_id = sp.playlist_id
                ORDER BY sp3.captured_at ASC
                LIMIT 1),
               0
             )
           END AS baseline_plays
    FROM snapshot_playlists sp
    GROUP BY song_id, playlist_id
  ), latest_pp AS (
    SELECT DISTINCT ON (song_id, playlist_id)
           song_id, playlist_id, plays AS latest_plays
    FROM snapshot_playlists
    ORDER BY song_id, playlist_id, captured_at DESC
  ), snapshots AS (
    SELECT COALESCE(SUM(GREATEST(COALESCE(l.latest_plays, 0) - COALESCE(b.baseline_plays, 0), 0)), 0)::bigint AS delivered
    FROM baseline_pp b
    LEFT JOIN latest_pp l
      ON l.song_id IS NOT DISTINCT FROM b.song_id
     AND l.playlist_id = b.playlist_id
  )
  SELECT CASE
    WHEN d.campaign_id IS NULL THEN GREATEST(d.stored_total, COALESCE(s.delivered, 0))::bigint
    ELSE GREATEST(COALESCE(e.delivered, 0), COALESCE(s.delivered, 0))::bigint
  END
  FROM deal d
  CROSS JOIN engine e
  CROSS JOIN snapshots s;
$function$;