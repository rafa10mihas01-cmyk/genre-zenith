
CREATE OR REPLACE FUNCTION public.get_curator_deal_progress(p_deal_id uuid, p_song_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_target bigint := 0;
  v_daily_goal bigint := 0;
  v_per_song jsonb := '[]'::jsonb;
BEGIN
  IF p_song_id IS NOT NULL THEN
    SELECT COALESCE(target_plays, 0), COALESCE(daily_goal, 0)
      INTO v_target, v_daily_goal
      FROM public.curator_deal_songs
     WHERE id = p_song_id AND deal_id = p_deal_id;
    IF v_target IS NULL THEN
      SELECT COALESCE(target_plays, 0), COALESCE(daily_goal, 0)
        INTO v_target, v_daily_goal
        FROM public.curator_deals WHERE id = p_deal_id;
    END IF;
  ELSE
    SELECT COALESCE(target_plays, 0), COALESCE(daily_goal, 0)
      INTO v_target, v_daily_goal
      FROM public.curator_deals WHERE id = p_deal_id;
  END IF;

  -- delivered_per_song (somente playlists do curador)
  WITH curator_pls AS (
    SELECT id FROM public.curator_playlists
     WHERE deal_id = p_deal_id AND match_status = 'curator'
  ),
  all_snaps AS (
    SELECT s.song_id, s.playlist_id, s.plays, s.captured_at, s.is_baseline
      FROM public.curator_deal_snapshots s
     WHERE s.deal_id = p_deal_id
       AND s.playlist_id IN (SELECT id FROM curator_pls)
  ),
  baseline_pp AS (
    SELECT song_id, playlist_id,
           COALESCE(
             (SELECT plays FROM all_snaps s2
               WHERE s2.song_id IS NOT DISTINCT FROM a.song_id
                 AND s2.playlist_id = a.playlist_id AND s2.is_baseline
               ORDER BY captured_at ASC LIMIT 1),
             (SELECT plays FROM all_snaps s3
               WHERE s3.song_id IS NOT DISTINCT FROM a.song_id
                 AND s3.playlist_id = a.playlist_id
               ORDER BY captured_at ASC LIMIT 1)
           ) AS baseline_plays
      FROM all_snaps a
     GROUP BY song_id, playlist_id
  ),
  latest_pp AS (
    SELECT DISTINCT ON (song_id, playlist_id)
           song_id, playlist_id, plays AS latest_plays, captured_at AS last_captured_at
      FROM all_snaps
     ORDER BY song_id, playlist_id, captured_at DESC
  ),
  per_song_playlist AS (
    SELECT b.song_id, b.playlist_id,
           b.baseline_plays, l.latest_plays, l.last_captured_at,
           GREATEST(COALESCE(l.latest_plays,0) - COALESCE(b.baseline_plays,0), 0) AS delivered
      FROM baseline_pp b
      LEFT JOIN latest_pp l ON l.song_id IS NOT DISTINCT FROM b.song_id AND l.playlist_id = b.playlist_id
  ),
  per_song AS (
    SELECT song_id,
      COALESCE(SUM(delivered), 0) AS delivered_curator,
      COALESCE(SUM(baseline_plays), 0) AS baseline_curator,
      COALESCE(SUM(latest_plays), 0) AS latest_curator,
      MIN(last_captured_at) AS first_capture_at,
      MAX(last_captured_at) AS last_capture_at
    FROM per_song_playlist
    GROUP BY song_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'song_id', ps.song_id,
    'target_plays', COALESCE(cds.target_plays, 0),
    'daily_goal', COALESCE(cds.daily_goal, 0),
    'baseline_total', ps.baseline_curator,
    'latest_total', ps.latest_curator,
    'delivered_curator', ps.delivered_curator,
    'first_capture_at', ps.first_capture_at,
    'last_capture_at', ps.last_capture_at,
    'progress_pct', CASE
      WHEN COALESCE(cds.target_plays,0) <= 0 THEN 0
      ELSE LEAST(100, ROUND((ps.delivered_curator::numeric / cds.target_plays::numeric) * 100, 1))
    END
  )), '[]'::jsonb)
  INTO v_per_song
  FROM per_song ps
  LEFT JOIN public.curator_deal_songs cds ON cds.id = ps.song_id;

  WITH curator_pls AS (
    SELECT id FROM public.curator_playlists
     WHERE deal_id = p_deal_id AND match_status = 'curator'
  ),
  snaps AS (
    SELECT s.playlist_id, s.plays, s.captured_at, s.is_baseline
      FROM public.curator_deal_snapshots s
     WHERE s.deal_id = p_deal_id
       AND s.playlist_id IN (SELECT id FROM curator_pls)
       AND (p_song_id IS NULL OR s.song_id = p_song_id)
  ),
  baseline_per_playlist AS (
    SELECT playlist_id,
           COALESCE(
             (SELECT plays FROM snaps s2
               WHERE s2.playlist_id = s.playlist_id AND s2.is_baseline
               ORDER BY captured_at ASC LIMIT 1),
             (SELECT plays FROM snaps s3
               WHERE s3.playlist_id = s.playlist_id
               ORDER BY captured_at ASC LIMIT 1)
           ) AS baseline_plays,
           COALESCE(
             (SELECT captured_at FROM snaps s2
               WHERE s2.playlist_id = s.playlist_id AND s2.is_baseline
               ORDER BY captured_at ASC LIMIT 1),
             (SELECT captured_at FROM snaps s3
               WHERE s3.playlist_id = s.playlist_id
               ORDER BY captured_at ASC LIMIT 1)
           ) AS baseline_at
      FROM snaps s
     GROUP BY playlist_id
  ),
  latest_per_playlist AS (
    SELECT DISTINCT ON (playlist_id)
           playlist_id, plays AS latest_plays, captured_at AS last_captured_at
      FROM snaps
     ORDER BY playlist_id, captured_at DESC
  ),
  per_playlist AS (
    SELECT b.playlist_id, cp.playlist_name, cp.is_baseline AS playlist_is_baseline,
           b.baseline_plays, b.baseline_at, l.latest_plays, l.last_captured_at,
           GREATEST(COALESCE(l.latest_plays,0) - COALESCE(b.baseline_plays,0), 0) AS delivered,
           (SELECT COUNT(*) FROM snaps s WHERE s.playlist_id = b.playlist_id AND s.captured_at > b.baseline_at)::int AS snapshot_count
    FROM baseline_per_playlist b
    LEFT JOIN latest_per_playlist l ON l.playlist_id = b.playlist_id
    LEFT JOIN public.curator_playlists cp ON cp.id = b.playlist_id
  ),
  totals AS (
    SELECT
      COALESCE(SUM(delivered), 0) AS delivered_curator,
      COALESCE(SUM(delivered), 0) AS delivered_total,
      COALESCE(SUM(baseline_plays), 0) AS baseline_curator,
      COALESCE(SUM(latest_plays), 0) AS latest_curator
    FROM per_playlist
  ),
  range_info AS (
    SELECT MIN(captured_at) AS first_capture, MAX(captured_at) AS last_capture FROM snaps
  )
  SELECT jsonb_build_object(
    'deal_id', p_deal_id,
    'song_id', p_song_id,
    'target_plays', v_target,
    'daily_goal', v_daily_goal,
    'baseline_total', t.baseline_curator,
    'latest_total', t.latest_curator,
    'delivered_curator', t.delivered_curator,
    'delivered_total', t.delivered_total,
    'first_capture_at', r.first_capture,
    'last_capture_at', r.last_capture,
    'days_elapsed', CASE
      WHEN r.first_capture IS NULL OR r.last_capture IS NULL THEN 0
      ELSE GREATEST(EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) / 86400.0, 0)
    END,
    'daily_avg', CASE
      WHEN r.first_capture IS NULL OR r.last_capture IS NULL
        OR EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) <= 0 THEN 0
      ELSE t.delivered_curator / (EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) / 86400.0)
    END,
    'progress_pct', CASE
      WHEN v_target <= 0 THEN 0
      ELSE LEAST(100, ROUND((t.delivered_curator::numeric / v_target::numeric) * 100, 1))
    END,
    'eta_days', CASE
      WHEN v_target <= 0 OR t.delivered_curator >= v_target THEN 0
      WHEN r.first_capture IS NULL OR r.last_capture IS NULL
        OR EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) <= 0 THEN NULL
      ELSE CEIL(
        (v_target - t.delivered_curator)::numeric
        / NULLIF(t.delivered_curator / (EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) / 86400.0), 0)
      )
    END,
    'per_playlist', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'playlist_id', pp.playlist_id,
        'playlist_name', pp.playlist_name,
        'is_baseline', pp.playlist_is_baseline,
        'baseline_plays', pp.baseline_plays,
        'latest_plays', pp.latest_plays,
        'delivered', pp.delivered,
        'last_captured_at', pp.last_captured_at,
        'snapshot_count', pp.snapshot_count
      ) ORDER BY pp.delivered DESC) FROM per_playlist pp),
      '[]'::jsonb
    ),
    'delivered_per_song', v_per_song
  )
  INTO v_result
  FROM totals t CROSS JOIN range_info r;

  RETURN COALESCE(v_result, jsonb_build_object(
    'deal_id', p_deal_id,
    'song_id', p_song_id,
    'target_plays', v_target,
    'daily_goal', v_daily_goal,
    'baseline_total', 0, 'latest_total', 0,
    'delivered_curator', 0, 'delivered_total', 0,
    'daily_avg', 0, 'days_elapsed', 0,
    'progress_pct', 0, 'eta_days', NULL,
    'per_playlist', '[]'::jsonb,
    'delivered_per_song', v_per_song
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_curator_deal_snapshot_history(p_deal_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      SUM(plays) AS total_plays
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
      'total_plays', total_plays
    ) ORDER BY captured_at ASC),
    '[]'::jsonb
  )
  FROM grouped;
$function$;
