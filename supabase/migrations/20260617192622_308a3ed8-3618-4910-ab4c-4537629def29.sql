
-- 1) RPC filtrada que reproduz vw_campaign_playlist_growth com filtro pushdown.
CREATE OR REPLACE FUNCTION public.get_campaign_playlist_growth(p_campaign_id uuid)
RETURNS TABLE (
  campaign_id uuid,
  playlist_id text,
  playlist_url text,
  current_name text,
  baseline_name text,
  baseline_plays integer,
  current_plays integer,
  delivery_accumulated bigint,
  delta bigint,
  last_import_delta bigint,
  baseline_at timestamptz,
  last_captured_at timestamptz,
  first_seen_at timestamptz,
  attributed_to text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH valid_collections AS (
    SELECT c.id, c.campaign_id, c.playlist_id, c.playlist_url,
           c.playlist_name_at_capture, c.plays_7d, c.captured_at, c.is_baseline,
           c.first_seen_at, c.created_at, c.upload_id, c.excluded
    FROM campaign_playlist_collections c
    LEFT JOIN label_spreadsheet_uploads u ON u.id = c.upload_id
    WHERE c.campaign_id = p_campaign_id
      AND COALESCE(c.excluded, false) = false
      AND (u.id IS NULL OR u.quarantined_at IS NULL)
  ),
  baseline AS (
    SELECT DISTINCT ON (playlist_id)
      playlist_id, plays_7d AS baseline_plays,
      playlist_name_at_capture AS baseline_name,
      captured_at AS baseline_at
    FROM valid_collections
    WHERE is_baseline = true
    ORDER BY playlist_id, captured_at DESC, created_at DESC
  ),
  latest_meta AS (
    SELECT DISTINCT ON (playlist_id)
      playlist_id,
      playlist_name_at_capture AS current_name,
      playlist_url,
      plays_7d AS latest_plays,
      captured_at AS last_captured_at
    FROM valid_collections
    ORDER BY playlist_id, captured_at DESC, created_at DESC
  ),
  all_ids AS (SELECT DISTINCT playlist_id FROM valid_collections),
  acc AS (
    SELECT f.playlist_id, f.delivery_accumulated, f.current_reading,
           f.last_reading_at, f.readings_count, f.last_import_delta
    FROM fn_playlist_delivery_accumulated(p_campaign_id) f
  ),
  firsts AS (
    SELECT playlist_id, min(first_seen_at) AS first_seen_at
    FROM valid_collections GROUP BY playlist_id
  ),
  eco AS (
    SELECT mp.spotify_playlist_id AS playlist_id
    FROM campaign_eco_allocations a
    JOIN managed_playlists mp ON mp.id = a.managed_playlist_id
    WHERE a.campaign_id = p_campaign_id AND mp.spotify_playlist_id IS NOT NULL
  ),
  internal_owned AS (
    SELECT DISTINCT mp.spotify_playlist_id AS playlist_id
    FROM managed_playlists mp WHERE mp.spotify_playlist_id IS NOT NULL
  ),
  curator_reg AS (
    SELECT DISTINCT ON (playlist_id)
      playlist_id, curator_id, status, excluded_from_kpis
    FROM curator_campaign_playlists
    WHERE campaign_id = p_campaign_id
    ORDER BY playlist_id,
      (CASE status WHEN 'matched' THEN 1 WHEN 'pending_match' THEN 2 WHEN 'baseline_conflict' THEN 3 ELSE 4 END)
  )
  SELECT p_campaign_id AS campaign_id,
         ai.playlist_id,
         lm.playlist_url,
         lm.current_name,
         b.baseline_name,
         b.baseline_plays,
         lm.latest_plays AS current_plays,
         acc.delivery_accumulated,
         GREATEST(COALESCE(lm.latest_plays,0) - COALESCE(b.baseline_plays,0), 0)::bigint AS delta,
         acc.last_import_delta,
         b.baseline_at,
         lm.last_captured_at,
         fr.first_seen_at,
         CASE
           WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'
           WHEN io.playlist_id IS NOT NULL THEN 'organic'
           WHEN cr.curator_id IS NOT NULL AND COALESCE(cr.excluded_from_kpis, false) = false THEN 'curator:' || cr.curator_id::text
           WHEN cr.curator_id IS NOT NULL AND cr.status = 'baseline_conflict' THEN 'curator:' || cr.curator_id::text
           ELSE 'organic'
         END AS attributed_to
  FROM all_ids ai
  LEFT JOIN baseline b ON b.playlist_id = ai.playlist_id
  LEFT JOIN latest_meta lm ON lm.playlist_id = ai.playlist_id
  LEFT JOIN acc ON acc.playlist_id = ai.playlist_id
  LEFT JOIN firsts fr ON fr.playlist_id = ai.playlist_id
  LEFT JOIN eco ON eco.playlist_id = ai.playlist_id
  LEFT JOIN internal_owned io ON io.playlist_id = ai.playlist_id
  LEFT JOIN curator_reg cr ON cr.playlist_id = ai.playlist_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_playlist_growth(uuid) TO authenticated, anon, service_role;

-- 2) Índice parcial para acelerar contagem de notificações não lidas.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id)
  WHERE read = false;
