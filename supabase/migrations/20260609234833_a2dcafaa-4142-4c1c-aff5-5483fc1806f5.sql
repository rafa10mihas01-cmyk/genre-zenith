
CREATE OR REPLACE FUNCTION public.fn_campaign_delivery_accumulated(p_campaign_id uuid)
RETURNS TABLE (
  curator_plays bigint,
  eco_plays bigint,
  organic_plays bigint,
  total_plays bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_playlist AS (
    SELECT * FROM public.fn_playlist_delivery_accumulated(p_campaign_id)
  ),
  curator_map AS (
    SELECT DISTINCT playlist_id
      FROM public.curator_campaign_playlists
     WHERE campaign_id = p_campaign_id
       AND curator_id IS NOT NULL
       AND COALESCE(excluded_from_kpis,false)=false
       AND status IN ('matched','baseline_conflict','pending_match')
  ),
  eco_map AS (
    SELECT DISTINCT mp.spotify_playlist_id AS playlist_id
      FROM public.campaign_eco_allocations a
      JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
     WHERE a.campaign_id = p_campaign_id
       AND mp.spotify_playlist_id IS NOT NULL
  ),
  classified AS (
    SELECT
      p.playlist_id,
      p.delivery_accumulated,
      CASE
        WHEN cm.playlist_id IS NOT NULL THEN 'curator'
        WHEN em.playlist_id IS NOT NULL THEN 'eco'
        ELSE 'organic'
      END AS bucket
    FROM per_playlist p
    LEFT JOIN curator_map cm ON cm.playlist_id = p.playlist_id
    LEFT JOIN eco_map     em ON em.playlist_id = p.playlist_id
  )
  SELECT
    COALESCE(SUM(delivery_accumulated) FILTER (WHERE bucket='curator'), 0)::bigint AS curator_plays,
    COALESCE(SUM(delivery_accumulated) FILTER (WHERE bucket='eco'),     0)::bigint AS eco_plays,
    COALESCE(SUM(delivery_accumulated) FILTER (WHERE bucket='organic'), 0)::bigint AS organic_plays,
    COALESCE(SUM(delivery_accumulated), 0)::bigint                                  AS total_plays
  FROM classified;
$$;
