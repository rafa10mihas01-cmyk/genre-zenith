CREATE OR REPLACE FUNCTION public.get_curator_deal_snapshot_history(p_deal_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH curator_pls AS (
    SELECT id, playlist_name, image_url, spotify_url, spotify_owner_name, followers
      FROM public.curator_playlists
     WHERE deal_id = p_deal_id
       AND (
         COALESCE(match_status, 'curator') IN ('curator', 'algorithmic', 'organic')
         OR is_baseline = true
       )
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
      v.song_id,
      v.print_urls
    FROM public.v_snapshot_prints v
    WHERE v.deal_id = p_deal_id
  ),
  logs AS (
    SELECT
      l.id AS log_id,
      date_trunc('minute', l.created_at) AS bucket,
      l.created_at,
      l.song_id,
      l.total_plays,
      l.is_baseline,
      l.print_urls,
      l.note
    FROM public.curator_deal_logs l
    WHERE l.deal_id = p_deal_id
  ),
  buckets AS (
    SELECT bucket FROM snaps
    UNION
    SELECT bucket FROM runs
    UNION
    SELECT bucket FROM logs
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
        FROM logs l, unnest(l.print_urls) AS u
        WHERE l.created_at >= b.bucket - INTERVAL '2 minutes'
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
        (SELECT MIN(l.created_at) FROM logs l WHERE l.bucket = b.bucket AND l.is_baseline),
        (SELECT MIN(s.captured_at) FROM snaps s WHERE s.bucket = b.bucket),
        (SELECT MIN(r.created_at)  FROM runs  r WHERE r.bucket = b.bucket),
        (SELECT MIN(l.created_at)  FROM logs  l WHERE l.bucket = b.bucket)
      ) AS captured_at,
      COALESCE(
        (SELECT bool_or(s.is_baseline) FROM snaps s WHERE s.bucket = b.bucket),
        false
      ) OR COALESCE(
        (SELECT bool_or(l.is_baseline) FROM logs l WHERE l.bucket = b.bucket),
        false
      ) AS is_baseline,
      COALESCE(
        NULLIF((SELECT COUNT(DISTINCT s.playlist_id) FROM snaps s WHERE s.bucket = b.bucket), 0),
        (SELECT COUNT(*) FROM curator_pls)
      )::int AS playlists_count,
      COALESCE(
        (SELECT l.song_id FROM logs l WHERE l.bucket = b.bucket ORDER BY l.is_baseline DESC, l.created_at DESC LIMIT 1),
        (SELECT s.song_id FROM snaps s WHERE s.bucket = b.bucket ORDER BY s.captured_at DESC LIMIT 1),
        (SELECT r.song_id FROM runs r WHERE r.bucket = b.bucket ORDER BY r.created_at DESC LIMIT 1)
      ) AS song_id,
      COALESCE(
        (SELECT l.total_plays FROM logs l WHERE l.bucket = b.bucket ORDER BY COALESCE(array_length(l.print_urls, 1), 0) DESC, l.created_at DESC LIMIT 1),
        NULLIF((SELECT c.cumulative_total FROM cumulative c WHERE c.bucket = b.bucket), 0),
        0
      )::bigint AS total_plays,
      (SELECT (ARRAY_AGG(s.print_url) FILTER (WHERE s.print_url IS NOT NULL))[1]
         FROM snaps s WHERE s.bucket = b.bucket) AS snap_print_url,
      (SELECT ARRAY(SELECT DISTINCT x
                      FROM unnest(ARRAY_AGG(s.print_url) FILTER (WHERE s.print_url IS NOT NULL)) AS t(x))
         FROM snaps s WHERE s.bucket = b.bucket) AS snap_print_urls,
      COALESCE(
        (SELECT l.note FROM logs l WHERE l.bucket = b.bucket AND l.note IS NOT NULL AND length(l.note) > 0 ORDER BY l.created_at DESC LIMIT 1),
        (SELECT (ARRAY_AGG(s.notes) FILTER (WHERE s.notes IS NOT NULL AND length(s.notes) > 0))[1]
           FROM snaps s WHERE s.bucket = b.bucket)
      ) AS note
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
  ),
  raw_entries AS (
    SELECT jsonb_build_object(
      'captured_at', bm.captured_at,
      'song_id', bm.song_id,
      'is_baseline', bm.is_baseline,
      'playlists_count', bm.playlists_count,
      'total_plays', bm.total_plays,
      'print_url', COALESCE(bp.print_urls[1], bm.snap_print_url),
      'print_urls', to_jsonb(bp.print_urls),
      'note', bm.note,
      'playlists', COALESCE(bpl.playlists, '[]'::jsonb)
    ) AS entry
    FROM bucket_meta bm
    LEFT JOIN bucket_playlists bpl ON bpl.bucket = bm.bucket
    LEFT JOIN bucket_prints bp ON bp.bucket = bm.bucket
    WHERE bm.captured_at IS NOT NULL
  ),
  ranked_entries AS (
    SELECT
      entry,
      row_number() OVER (
        PARTITION BY
          CASE
            WHEN COALESCE((entry->>'is_baseline')::boolean, false)
              THEN 'baseline:' || COALESCE(entry->>'captured_at', random()::text)
            ELSE COALESCE(entry->>'song_id', '_') || ':' || left(entry->>'captured_at', 10)
          END
        ORDER BY
          jsonb_array_length(COALESCE(entry->'print_urls', '[]'::jsonb)) DESC,
          (entry->>'captured_at')::timestamptz DESC
      ) AS rn
    FROM raw_entries
  )
  SELECT COALESCE(
    jsonb_agg(entry ORDER BY (entry->>'captured_at')::timestamptz ASC),
    '[]'::jsonb
  )
  FROM ranked_entries
  WHERE rn = 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_curator_deal_snapshot_history(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_curator_deal_snapshot_history(uuid) TO service_role;