
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
  v_per_song_total bigint := 0;
  v_engine bigint := 0;
  v_delivered bigint := 0;
  v_started timestamptz;
  v_days numeric := 0;
  v_daily_avg numeric := 0;
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

  WITH curator_pls AS (
    SELECT id, attribution_method FROM public.curator_playlists
     WHERE deal_id = p_deal_id AND match_status = 'curator'
       AND COALESCE(is_observational, false) = false
  ),
  all_snaps AS (
    SELECT s.song_id, s.playlist_id, s.plays, s.captured_at, s.is_baseline,
           cp.attribution_method
      FROM public.curator_deal_snapshots s
      JOIN curator_pls cp ON cp.id = s.playlist_id
     WHERE s.deal_id = p_deal_id
  ),
  baseline_pp AS (
    SELECT song_id, playlist_id,
           CASE
             WHEN MAX(attribution_method) IN ('late_discovery_zero', 'manual_zero') THEN 0
             ELSE COALESCE(
               (SELECT plays FROM all_snaps s2
                 WHERE s2.song_id IS NOT DISTINCT FROM a.song_id
                   AND s2.playlist_id = a.playlist_id AND s2.is_baseline
                 ORDER BY captured_at ASC LIMIT 1),
               (SELECT plays FROM all_snaps s3
                 WHERE s3.song_id IS NOT DISTINCT FROM a.song_id
                   AND s3.playlist_id = a.playlist_id
                 ORDER BY captured_at ASC LIMIT 1)
             )
           END AS baseline_plays
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
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
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
    )), '[]'::jsonb),
    COALESCE(SUM(ps.delivered_curator), 0)::bigint
  INTO v_per_song, v_per_song_total
  FROM per_song ps
  LEFT JOIN public.curator_deal_songs cds ON cds.id = ps.song_id;

  -- Engine (Growth Engine) é a fonte oficial QUANDO há campanha vinculada.
  v_engine := COALESCE(public.fn_deal_delivery_accumulated(p_deal_id), 0);

  -- Fallback: se o engine não retornou nada (deal sem campanha ou pipeline
  -- ainda sem dados consolidados), usa a soma dos snapshots por música.
  v_delivered := GREATEST(v_engine, v_per_song_total);

  SELECT started_at INTO v_started FROM public.curator_deals WHERE id = p_deal_id;
  v_days := GREATEST(1, EXTRACT(EPOCH FROM (now() - COALESCE(v_started, now()))) / 86400.0);
  v_daily_avg := v_delivered::numeric / v_days;

  v_result := jsonb_build_object(
    'deal_id', p_deal_id,
    'song_id', p_song_id,
    'target_plays', v_target,
    'daily_goal', v_daily_goal,
    'baseline_total', 0,
    'latest_total', v_delivered,
    'delivered_curator', v_delivered,
    'delivered_total', v_delivered,
    'daily_avg', v_daily_avg,
    'days_elapsed', v_days,
    'progress_pct', CASE
      WHEN v_target <= 0 THEN 0
      ELSE LEAST(100, ROUND((v_delivered::numeric / NULLIF(v_target,0)::numeric) * 100, 1))
    END,
    'eta_days', CASE
      WHEN v_target <= 0 OR v_delivered >= v_target THEN 0
      WHEN v_daily_avg <= 0 THEN NULL
      ELSE CEIL((v_target - v_delivered)::numeric / v_daily_avg)
    END,
    'today_plays', NULL,
    'per_playlist', '[]'::jsonb,
    'delivered_per_song', v_per_song
  );

  RETURN v_result;
END;
$function$;
