
CREATE OR REPLACE VIEW public.vw_campaign_playlist_growth AS
WITH baseline AS (
  SELECT campaign_id, playlist_id, plays_7d AS baseline_plays,
         playlist_name_at_capture AS baseline_name,
         captured_at AS baseline_at
  FROM public.campaign_playlist_collections
  WHERE is_baseline = true
),
latest AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
    campaign_id, playlist_id, plays_7d AS current_plays,
    playlist_name_at_capture AS current_name,
    playlist_url, captured_at AS last_captured_at,
    first_seen_at
  FROM public.campaign_playlist_collections
  ORDER BY campaign_id, playlist_id, captured_at DESC
),
all_ids AS (
  SELECT DISTINCT campaign_id, playlist_id FROM public.campaign_playlist_collections
),
eco AS (
  SELECT a.campaign_id, mp.spotify_playlist_id AS playlist_id
  FROM public.campaign_eco_allocations a
  JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
  WHERE mp.spotify_playlist_id IS NOT NULL
),
curator_reg AS (
  SELECT campaign_id, playlist_id, curator_id
  FROM public.curator_campaign_playlists
)
SELECT
  ai.campaign_id,
  ai.playlist_id,
  l.playlist_url,
  l.current_name,
  b.baseline_name,
  b.baseline_plays,
  l.current_plays,
  (COALESCE(l.current_plays, 0) - COALESCE(b.baseline_plays, 0)) AS delta,
  b.baseline_at,
  l.last_captured_at,
  l.first_seen_at,
  CASE
    WHEN cr.curator_id IS NOT NULL THEN 'curator:' || cr.curator_id::text
    WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'
    ELSE 'organic'
  END AS attributed_to,
  cr.curator_id AS attributed_curator_id
FROM all_ids ai
LEFT JOIN baseline b ON b.campaign_id = ai.campaign_id AND b.playlist_id = ai.playlist_id
LEFT JOIN latest l ON l.campaign_id = ai.campaign_id AND l.playlist_id = ai.playlist_id
LEFT JOIN curator_reg cr ON cr.campaign_id = ai.campaign_id AND cr.playlist_id = ai.playlist_id
LEFT JOIN eco ON eco.campaign_id = ai.campaign_id AND eco.playlist_id = ai.playlist_id;

ALTER VIEW public.vw_campaign_playlist_growth SET (security_invoker = true);
