CREATE OR REPLACE FUNCTION public.fn_playlist_delivery_accumulated(p_campaign_id uuid)
RETURNS TABLE(
  playlist_id text,
  delivery_accumulated bigint,
  current_reading bigint,
  last_reading_at timestamptz,
  readings_count integer,
  last_import_delta bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
             -- 1ª leitura SEMPRE é baseline implícito (delta = 0),
             -- esteja flagada como is_baseline ou não.
             WHEN rn = 1 THEN 0::bigint
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

GRANT EXECUTE ON FUNCTION public.fn_playlist_delivery_accumulated(uuid) TO authenticated, anon, service_role;

-- Recalcula total_delivered de todas as campanhas ativas usando a nova regra.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.campaigns WHERE status IN ('active','running','live') LOOP
    PERFORM public.recompute_campaign_total_delivered(r.id);
  END LOOP;
END $$;