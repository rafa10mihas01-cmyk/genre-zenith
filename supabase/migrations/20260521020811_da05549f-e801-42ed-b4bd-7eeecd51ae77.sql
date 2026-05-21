CREATE OR REPLACE FUNCTION public.get_curator_deal_snapshot_history(p_deal_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  buckets AS (
    SELECT DISTINCT bucket FROM snaps
  ),
  latest_per_pl AS (
    SELECT b.bucket, cp.id AS playlist_id,
      (
        SELECT s2.plays FROM snaps s2
         WHERE s2.playlist_id = cp.id AND s2.bucket <= b.bucket
         ORDER BY s2.captured_at DESC LIMIT 1
      ) AS plays
    FROM buckets b CROSS JOIN curator_pls cp
  ),
  cumulative AS (
    SELECT bucket, COALESCE(SUM(plays), 0)::bigint AS cumulative_total
    FROM latest_per_pl
    GROUP BY bucket
  ),
  -- Logs (curator_deal_logs) carregam o array COMPLETO de prints daquela coleta.
  -- Casamos pelo minuto do bucket; também aceita logs até 2 minutos antes/depois
  -- pra cobrir pequenas defasagens entre o insert do log e o insert do snapshot.
  bucket_logs AS (
    SELECT
      b.bucket,
      ARRAY(
        SELECT DISTINCT u
        FROM public.curator_deal_logs l,
             unnest(l.print_urls) AS u
        WHERE l.deal_id = p_deal_id
          AND l.created_at >= b.bucket - INTERVAL '2 minutes'
          AND l.created_at <  b.bucket + INTERVAL '3 minutes'
          AND u IS NOT NULL
      ) AS log_print_urls
    FROM buckets b
  ),
  bucket_meta AS (
    SELECT
      s.bucket,
      MIN(s.captured_at) AS captured_at,
      bool_or(s.is_baseline) AS is_baseline,
      COUNT(DISTINCT s.playlist_id) AS playlists_count,
      (ARRAY_AGG(s.print_url) FILTER (WHERE s.print_url IS NOT NULL))[1] AS snap_print_url,
      ARRAY(
        SELECT DISTINCT x
          FROM unnest(ARRAY_AGG(s.print_url) FILTER (WHERE s.print_url IS NOT NULL)) AS t(x)
      ) AS snap_print_urls,
      (ARRAY_AGG(s.notes) FILTER (WHERE s.notes IS NOT NULL AND length(s.notes) > 0))[1] AS note
    FROM snaps s
    GROUP BY s.bucket
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
  -- União final: log (fonte da verdade) ∪ snapshot (fallback)
  bucket_prints AS (
    SELECT
      bm.bucket,
      ARRAY(
        SELECT DISTINCT u
        FROM unnest(
          COALESCE(bl.log_print_urls, ARRAY[]::text[]) ||
          COALESCE(bm.snap_print_urls, ARRAY[]::text[])
        ) AS u
        WHERE u IS NOT NULL
      ) AS print_urls
    FROM bucket_meta bm
    LEFT JOIN bucket_logs bl ON bl.bucket = bm.bucket
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'captured_at', bm.captured_at,
      'is_baseline', bm.is_baseline,
      'playlists_count', bm.playlists_count,
      'total_plays', c.cumulative_total,
      'print_url', COALESCE(bp.print_urls[1], bm.snap_print_url),
      'print_urls', to_jsonb(bp.print_urls),
      'note', bm.note,
      'playlists', COALESCE(bpl.playlists, '[]'::jsonb)
    ) ORDER BY bm.captured_at ASC),
    '[]'::jsonb
  )
  FROM bucket_meta bm
  JOIN cumulative c ON c.bucket = bm.bucket
  LEFT JOIN bucket_playlists bpl ON bpl.bucket = bm.bucket
  LEFT JOIN bucket_prints bp ON bp.bucket = bm.bucket;
$function$;