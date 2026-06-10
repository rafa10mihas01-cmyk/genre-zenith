
-- Drop view first because the function's return signature changes
DROP VIEW IF EXISTS public.vw_campaign_playlist_growth;
DROP FUNCTION IF EXISTS public.fn_playlist_delivery_accumulated(uuid);

CREATE OR REPLACE FUNCTION public.fn_playlist_delivery_accumulated(p_campaign_id uuid)
RETURNS TABLE(
  playlist_id text,
  delivery_accumulated bigint,
  current_reading bigint,
  last_reading_at timestamp with time zone,
  readings_count integer,
  last_import_delta bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH valid AS (
    SELECT c.playlist_id,
           c.plays_7d,
           c.is_baseline,
           c.captured_at,
           COALESCE(u.created_at, c.created_at) AS up_created
      FROM public.campaign_playlist_collections c
      LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
     WHERE c.campaign_id = p_campaign_id
       AND COALESCE(c.excluded, false) = false
       AND (u.id IS NULL OR u.quarantined_at IS NULL)
  ),
  ordered AS (
    SELECT playlist_id, plays_7d, is_baseline, up_created, captured_at,
           ROW_NUMBER() OVER (PARTITION BY playlist_id ORDER BY up_created, captured_at) AS rn,
           LAG(plays_7d) OVER (PARTITION BY playlist_id ORDER BY up_created, captured_at) AS prev_plays
      FROM valid
  ),
  with_delta AS (
    SELECT playlist_id, plays_7d, captured_at, rn, prev_plays,
           CASE
             WHEN rn = 1 AND is_baseline THEN 0::bigint
             WHEN rn = 1 AND NOT is_baseline THEN GREATEST(0, plays_7d)::bigint
             ELSE GREATEST(0, plays_7d - COALESCE(prev_plays, plays_7d))::bigint
           END AS delta_pos
      FROM ordered
  ),
  totals AS (
    SELECT playlist_id,
           SUM(delta_pos)::bigint AS delivery_accumulated,
           MAX(plays_7d)::bigint  AS current_reading,
           MAX(captured_at)       AS last_reading_at,
           COUNT(*)::int          AS readings_count,
           MAX(rn)                AS max_rn
      FROM with_delta
     GROUP BY playlist_id
  ),
  last_row AS (
    SELECT w.playlist_id,
           -- last_import_delta = positive delta of the most recent reading vs the previous one;
           -- NULL when there is no previous reading (only one import)
           CASE
             WHEN w.prev_plays IS NULL THEN NULL
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
$function$;

-- Recreate the view, adding last_import_delta passthrough
CREATE OR REPLACE VIEW public.vw_campaign_playlist_growth AS
WITH valid_collections AS (
  SELECT c.id, c.campaign_id, c.playlist_id, c.playlist_url,
         c.playlist_name_at_capture, c.plays_7d, c.captured_at,
         c.is_baseline, c.first_seen_at, c.source, c.proof_screenshot_url,
         c.created_at, c.collection_run_id, c.proof_screenshot_urls,
         c.snapshot_run_id, c.upload_id, c.excluded, c.exclusion_reason
    FROM campaign_playlist_collections c
    LEFT JOIN label_spreadsheet_uploads u ON u.id = c.upload_id
   WHERE COALESCE(c.excluded, false) = false
     AND (u.id IS NULL OR u.quarantined_at IS NULL)
),
baseline AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id,
         plays_7d AS baseline_plays,
         playlist_name_at_capture AS baseline_name,
         captured_at AS baseline_at
    FROM valid_collections
   WHERE is_baseline = true
   ORDER BY campaign_id, playlist_id, captured_at DESC, created_at DESC
),
latest_meta AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id,
         playlist_name_at_capture AS current_name,
         playlist_url,
         plays_7d AS latest_plays,
         captured_at AS last_captured_at
    FROM valid_collections
   ORDER BY campaign_id, playlist_id, captured_at DESC, created_at DESC
),
campaigns_with_data AS (SELECT DISTINCT campaign_id FROM valid_collections),
all_ids AS (SELECT DISTINCT campaign_id, playlist_id FROM valid_collections),
acc AS (
  SELECT c.campaign_id, f.playlist_id, f.delivery_accumulated, f.current_reading,
         f.last_reading_at, f.readings_count, f.last_import_delta
    FROM campaigns_with_data c
    CROSS JOIN LATERAL fn_playlist_delivery_accumulated(c.campaign_id) f
),
firsts AS (
  SELECT campaign_id, playlist_id, MIN(first_seen_at) AS first_seen_at
    FROM valid_collections
   GROUP BY campaign_id, playlist_id
),
eco AS (
  SELECT a.campaign_id, mp.spotify_playlist_id AS playlist_id
    FROM campaign_eco_allocations a
    JOIN managed_playlists mp ON mp.id = a.managed_playlist_id
   WHERE mp.spotify_playlist_id IS NOT NULL
),
internal_owned AS (
  SELECT DISTINCT mp.spotify_playlist_id AS playlist_id
    FROM managed_playlists mp
   WHERE mp.spotify_playlist_id IS NOT NULL
),
curator_reg AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id, curator_id, status, excluded_from_kpis
    FROM curator_campaign_playlists
   ORDER BY campaign_id, playlist_id, (
     CASE status
       WHEN 'matched'           THEN 1
       WHEN 'pending_match'     THEN 2
       WHEN 'baseline_conflict' THEN 3
       ELSE 4
     END)
)
SELECT ai.campaign_id,
       ai.playlist_id,
       lm.playlist_url,
       lm.current_name,
       b.baseline_name,
       b.baseline_plays,
       lm.latest_plays AS current_plays,
       COALESCE(acc.delivery_accumulated, 0::bigint) AS delivery_accumulated,
       COALESCE(acc.delivery_accumulated, 0::bigint) AS delta,
       acc.last_import_delta,
       b.baseline_at,
       lm.last_captured_at,
       fr.first_seen_at,
       CASE
         WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'::text
         WHEN io.playlist_id  IS NOT NULL THEN 'organic'::text
         WHEN cr.curator_id IS NOT NULL AND COALESCE(cr.excluded_from_kpis, false) = false
              THEN 'curator:'::text || cr.curator_id::text
         WHEN cr.curator_id IS NOT NULL AND cr.status = 'baseline_conflict'::text
              THEN 'curator:'::text || cr.curator_id::text
         ELSE 'organic'::text
       END AS attributed_to
  FROM all_ids ai
  LEFT JOIN baseline      b  ON b.campaign_id  = ai.campaign_id AND b.playlist_id  = ai.playlist_id
  LEFT JOIN latest_meta   lm ON lm.campaign_id = ai.campaign_id AND lm.playlist_id = ai.playlist_id
  LEFT JOIN acc              ON acc.campaign_id= ai.campaign_id AND acc.playlist_id= ai.playlist_id
  LEFT JOIN firsts        fr ON fr.campaign_id = ai.campaign_id AND fr.playlist_id = ai.playlist_id
  LEFT JOIN eco              ON eco.campaign_id= ai.campaign_id AND eco.playlist_id= ai.playlist_id
  LEFT JOIN internal_owned io ON io.playlist_id = ai.playlist_id
  LEFT JOIN curator_reg   cr ON cr.campaign_id = ai.campaign_id AND cr.playlist_id = ai.playlist_id;

GRANT SELECT ON public.vw_campaign_playlist_growth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_playlist_delivery_accumulated(uuid) TO anon, authenticated, service_role;
