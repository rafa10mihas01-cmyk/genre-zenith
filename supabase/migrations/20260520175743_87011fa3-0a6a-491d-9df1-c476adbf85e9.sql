
CREATE OR REPLACE FUNCTION public.get_curator_deal_snapshot_history(p_deal_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH curator_pls AS (
    SELECT id FROM public.curator_playlists
     WHERE deal_id = p_deal_id AND match_status = 'curator'
  ),
  grouped AS (
    SELECT
      date_trunc('minute', captured_at) AS bucket,
      MIN(captured_at) AS captured_at,
      bool_or(is_baseline) AS is_baseline,
      COUNT(DISTINCT playlist_id) AS playlists_count,
      SUM(plays) AS total_plays,
      -- pega a primeira URL não-nula do bucket (todos os snaps do mesmo print compartilham o mesmo print_url)
      (ARRAY_AGG(print_url) FILTER (WHERE print_url IS NOT NULL))[1] AS print_url
    FROM public.curator_deal_snapshots
    WHERE deal_id = p_deal_id
      AND playlist_id IN (SELECT id FROM curator_pls)
    GROUP BY 1
    ORDER BY 1 ASC
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'captured_at', captured_at,
      'is_baseline', is_baseline,
      'playlists_count', playlists_count,
      'total_plays', total_plays,
      'print_url', print_url
    ) ORDER BY captured_at ASC),
    '[]'::jsonb
  )
  FROM grouped;
$$;
