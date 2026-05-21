CREATE OR REPLACE FUNCTION public.get_curator_deal_snapshot_history(p_deal_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH curator_pls AS (
    SELECT id, playlist_name, image_url, spotify_url, spotify_owner_name, followers
      FROM public.curator_playlists
     WHERE deal_id = p_deal_id AND match_status = 'curator'
  ),
  snaps AS (
    SELECT s.*, date_trunc('minute', s.captured_at) AS bucket
      FROM public.curator_deal_snapshots s
     WHERE s.deal_id = p_deal_id
       AND s.playlist_id IN (SELECT id FROM curator_pls)
  ),
  bucket_playlists AS (
    SELECT
      s.bucket,
      jsonb_agg(
        jsonb_build_object(
          'playlist_id', cp.id,
          'playlist_name', cp.playlist_name,
          'image_url', cp.image_url,
          'spotify_url', cp.spotify_url,
          'spotify_owner_name', cp.spotify_owner_name,
          'followers', cp.followers,
          'plays', s.plays,
          'plays_7d', s.plays_7d
        )
        ORDER BY s.plays DESC NULLS LAST, cp.playlist_name ASC
      ) AS playlists
    FROM snaps s
    JOIN curator_pls cp ON cp.id = s.playlist_id
    GROUP BY s.bucket
  ),
  grouped AS (
    SELECT
      s.bucket,
      MIN(s.captured_at) AS captured_at,
      bool_or(s.is_baseline) AS is_baseline,
      COUNT(DISTINCT s.playlist_id) AS playlists_count,
      SUM(s.plays) AS total_plays,
      (ARRAY_AGG(s.print_url) FILTER (WHERE s.print_url IS NOT NULL))[1] AS print_url,
      ARRAY(
        SELECT DISTINCT x
          FROM unnest(ARRAY_AGG(s.print_url) FILTER (WHERE s.print_url IS NOT NULL)) AS t(x)
      ) AS print_urls,
      (ARRAY_AGG(s.notes) FILTER (WHERE s.notes IS NOT NULL AND length(s.notes) > 0))[1] AS note
    FROM snaps s
    GROUP BY s.bucket
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'captured_at', g.captured_at,
      'is_baseline', g.is_baseline,
      'playlists_count', g.playlists_count,
      'total_plays', g.total_plays,
      'print_url', g.print_url,
      'print_urls', to_jsonb(g.print_urls),
      'note', g.note,
      'playlists', COALESCE(bp.playlists, '[]'::jsonb)
    ) ORDER BY g.captured_at ASC),
    '[]'::jsonb
  )
  FROM grouped g
  LEFT JOIN bucket_playlists bp ON bp.bucket = g.bucket;
$$;