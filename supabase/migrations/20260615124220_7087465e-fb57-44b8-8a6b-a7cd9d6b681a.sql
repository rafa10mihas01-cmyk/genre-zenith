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
      LEFT JOIN public.bot_print_batches b
        ON b.id = COALESCE(s.snapshot_run_id, s.batch_id)
     WHERE s.deal_id = p_deal_id
       AND s.playlist_id IN (SELECT id FROM curator_pls)
       AND (
         COALESCE(s.snapshot_run_id, s.batch_id) IS NULL
         OR b.superseded_by IS NULL
       )
  ),
  runs AS (
    SELECT
      v.run_id,
      date_trunc('minute', v.created_at) AS bucket,
      v.created_at,
      v.print_urls
    FROM public.v_snapshot_prints v
    WHERE v.deal_id = p_deal_id
  ),
  buckets AS (
    SELECT bucket FROM snaps
    UNION
    SELECT bucket FROM runs
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
    SELECT b.bucket, COALESCE(SUM(lp.plays), 0)::bigint AS cumulative_total
    FROM (SELECT DISTINCT bucket FROM buckets) b
    LEFT JOIN latest_per_pl lp ON lp.bucket = b.bucket
    GROUP BY b.bucket
  ),
  bucket_logs AS (
    SELECT
      b.bucket,
      ARRAY(
        SELECT DISTINCT u
        FROM public.curator_deal_logs l, unnest(l.print_urls) AS u
        WHERE l.deal_id = p_deal_id
          AND l.created_at >= b.bucket - INTERVAL '2 minutes'
          AND l.created_at <  b.bucket + INTERVAL '3 minutes'
          AND u IS NOT NULL
      ) AS log_print_urls
    FROM buckets b
  ),
  bucket_runs AS (
    SELECT
      bk.bucket,
      ARRAY(
        SELECT DISTINCT u
        FROM runs r, unnest(r.print_urls) AS u
        WHERE r.bucket = bk.bucket AND u IS NOT NULL
      ) AS run_print_urls
    FROM (SELECT DISTINCT bucket FROM buckets) bk
  ),
  bucket_meta AS (
    SELECT
      b.bucket,
      COALESCE(
        (SELECT MIN(s.captured_at) FROM snaps s WHERE s.bucket = b.bucket),
        (SELECT MIN(r.created_at)  FROM runs  r WHERE r.bucket = b.bucket)
      ) AS captured_at,
      COALESCE(
        (SELECT bool_or(s.is_baseline) FROM snaps s WHERE s.bucket = b.bucket),
        false
      ) AS is_baseline,
      COALESCE(
        (SELECT COUNT(DISTINCT s.playlist_id) FROM snaps s WHERE s.bucket = b.bucket),
        0
      )::int AS playlists_count,
      (SELECT (ARRAY_AGG(s.print_url) FILTER (WHERE s.print_url IS NOT NULL))[1]
         FROM snaps s WHERE s.bucket = b.bucket) AS snap_print_url,
      (SELECT ARRAY(SELECT DISTINCT x
                      FROM unnest(ARRAY_AGG(s.print_url) FILTER (WHERE s.print_url IS NOT NULL)) AS t(x))
         FROM snaps s WHERE s.bucket = b.bucket) AS snap_print_urls,
      (SELECT (ARRAY_AGG(s.notes) FILTER (WHERE s.notes IS NOT NULL AND length(s.notes) > 0))[1]
         FROM snaps s WHERE s.bucket = b.bucket) AS note
    FROM (SELECT DISTINCT bucket FROM buckets) b
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
  bucket_prints AS (
    SELECT
      bm.bucket,
      ARRAY(
        SELECT DISTINCT u
        FROM unnest(
          COALESCE(br.run_print_urls, ARRAY[]::text[]) ||
          COALESCE(bl.log_print_urls, ARRAY[]::text[]) ||
          COALESCE(bm.snap_print_urls, ARRAY[]::text[])
        ) AS u
        WHERE u IS NOT NULL
      ) AS print_urls
    FROM bucket_meta bm
    LEFT JOIN bucket_logs bl ON bl.bucket = bm.bucket
    LEFT JOIN bucket_runs br ON br.bucket = bm.bucket
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