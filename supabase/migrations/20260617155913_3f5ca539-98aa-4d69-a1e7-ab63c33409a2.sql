
-- 1) Renomeia a coluna na tabela de snapshots
ALTER TABLE public.curator_deal_snapshots
  RENAME COLUMN is_baseline TO is_initial_capture;

-- 2) fn_deal_delivery_accumulated — usa is_initial_capture do snapshot
CREATE OR REPLACE FUNCTION public.fn_deal_delivery_accumulated(p_deal_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH deal AS (
    SELECT id, campaign_id, curator_id, COALESCE(reconciled_total_plays, 0)::bigint AS stored_total
    FROM public.curator_deals
    WHERE id = p_deal_id
  ), engine AS (
    SELECT COALESCE(SUM(c.delivery_accumulated), 0)::bigint AS delivered
    FROM deal d
    JOIN public.fn_curator_delivery_accumulated(d.campaign_id) c
      ON c.curator_id = d.curator_id
    WHERE d.campaign_id IS NOT NULL
  ), snapshot_playlists AS (
    SELECT s.song_id, s.playlist_id, s.plays, s.captured_at, s.is_initial_capture, cp.attribution_method
    FROM public.curator_deal_snapshots s
    JOIN public.curator_playlists cp ON cp.id = s.playlist_id
    WHERE s.deal_id = p_deal_id
      AND cp.deal_id = p_deal_id
      AND cp.match_status = 'curator'
      AND COALESCE(cp.is_observational, false) = false
  ), baseline_pp AS (
    SELECT song_id, playlist_id,
           CASE
             WHEN MAX(attribution_method) IN ('late_discovery_zero', 'manual_zero') THEN 0
             ELSE COALESCE(
               (SELECT sp2.plays FROM snapshot_playlists sp2
                WHERE sp2.song_id IS NOT DISTINCT FROM sp.song_id
                  AND sp2.playlist_id = sp.playlist_id
                  AND sp2.is_initial_capture
                ORDER BY sp2.captured_at ASC
                LIMIT 1),
               (SELECT sp3.plays FROM snapshot_playlists sp3
                WHERE sp3.song_id IS NOT DISTINCT FROM sp.song_id
                  AND sp3.playlist_id = sp.playlist_id
                ORDER BY sp3.captured_at ASC
                LIMIT 1),
               0
             )
           END AS baseline_plays
    FROM snapshot_playlists sp
    GROUP BY song_id, playlist_id
  ), latest_pp AS (
    SELECT DISTINCT ON (song_id, playlist_id)
           song_id, playlist_id, plays AS latest_plays
    FROM snapshot_playlists
    ORDER BY song_id, playlist_id, captured_at DESC
  ), snapshots AS (
    SELECT COALESCE(SUM(GREATEST(COALESCE(l.latest_plays, 0) - COALESCE(b.baseline_plays, 0), 0)), 0)::bigint AS delivered
    FROM baseline_pp b
    LEFT JOIN latest_pp l
      ON l.song_id IS NOT DISTINCT FROM b.song_id
     AND l.playlist_id = b.playlist_id
  )
  SELECT CASE
    WHEN d.campaign_id IS NULL THEN GREATEST(d.stored_total, COALESCE(s.delivered, 0))::bigint
    ELSE GREATEST(COALESCE(e.delivered, 0), COALESCE(s.delivered, 0))::bigint
  END
  FROM deal d
  CROSS JOIN engine e
  CROSS JOIN snapshots s;
$function$;

-- 3) get_campaign_analytics_overview — filtra is_initial_capture
CREATE OR REPLACE FUNCTION public.get_campaign_analytics_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_totals jsonb; v_top jsonb; v_bottom jsonb; v_status_over_time jsonb; v_cost_per_play numeric;
BEGIN
  SELECT jsonb_build_object(
    'total_campaigns', COUNT(*)::int,
    'active_campaigns', COUNT(*) FILTER (WHERE status='active')::int,
    'completed_campaigns', COUNT(*) FILTER (WHERE status='completed')::int,
    'draft_campaigns', COUNT(*) FILTER (WHERE status='draft')::int,
    'paused_campaigns', COUNT(*) FILTER (WHERE status='paused')::int,
    'total_promised', COALESCE(SUM(total_allocated),0)::bigint,
    'total_delivered', COALESCE(SUM(total_delivered),0)::bigint,
    'avg_fulfillment_rate', CASE WHEN SUM(total_allocated) > 0
      THEN (SUM(total_delivered)::numeric / SUM(total_allocated)::numeric) ELSE NULL END
  ) INTO v_totals FROM public.campaigns;

  SELECT jsonb_agg(t) INTO v_top FROM (
    SELECT h.playlist_id, p.name AS playlist_name, p.cover_url,
           h.campaigns_count, h.total_promised, h.total_delivered, h.fulfillment_rate, h.avg_daily_delivery
    FROM public.v_playlist_delivery_history h
    JOIN public.playlists p ON p.id = h.playlist_id
    WHERE h.campaigns_count >= 1 AND h.fulfillment_rate IS NOT NULL
    ORDER BY h.fulfillment_rate DESC, h.total_delivered DESC LIMIT 10
  ) t;

  SELECT jsonb_agg(t) INTO v_bottom FROM (
    SELECT h.playlist_id, p.name AS playlist_name, p.cover_url,
           h.campaigns_count, h.total_promised, h.total_delivered, h.fulfillment_rate, h.avg_daily_delivery
    FROM public.v_playlist_delivery_history h
    JOIN public.playlists p ON p.id = h.playlist_id
    WHERE h.campaigns_count >= 1 AND h.fulfillment_rate IS NOT NULL
    ORDER BY h.fulfillment_rate ASC, h.total_delivered ASC LIMIT 10
  ) t;

  SELECT jsonb_agg(t ORDER BY month) INTO v_status_over_time FROM (
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, status, COUNT(*)::int AS count
    FROM public.campaigns WHERE created_at >= now() - interval '12 months'
    GROUP BY 1, 2
  ) t;

  SELECT CASE WHEN COALESCE(plays.delta,0) > 0 AND COALESCE(spend.amt,0) > 0
              THEN (spend.amt / plays.delta::numeric) ELSE NULL END
  INTO v_cost_per_play
  FROM (SELECT SUM(amount) AS amt FROM public.curator_purchases) spend,
       (SELECT GREATEST(0, SUM(plays))::bigint AS delta FROM public.curator_deal_snapshots WHERE is_initial_capture = false) plays;

  RETURN jsonb_build_object(
    'totals', v_totals,
    'top_performers', COALESCE(v_top, '[]'::jsonb),
    'bottom_performers', COALESCE(v_bottom, '[]'::jsonb),
    'campaigns_by_status_over_time', COALESCE(v_status_over_time, '[]'::jsonb),
    'cost_per_play', v_cost_per_play,
    'generated_at', now()
  );
END; $function$;

-- 4) get_curator_deal_breakdown — usa is_initial_capture nas snapshots
CREATE OR REPLACE FUNCTION public.get_curator_deal_breakdown(p_deal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_baseline bigint;
  v_target bigint;
  v_result jsonb;
  v_is_service boolean := (current_setting('request.jwt.claim.role', true) = 'service_role')
                          OR (auth.role() = 'service_role');
BEGIN
  SELECT user_id, COALESCE(baseline_plays,0), COALESCE(target_plays,0)
    INTO v_owner, v_baseline, v_target
  FROM public.curator_deals
  WHERE id = p_deal_id;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('error','deal_not_found');
  END IF;

  IF NOT v_is_service
     AND v_owner IS DISTINCT FROM auth.uid()
     AND NOT public.has_team_access() THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (s.playlist_id)
      s.playlist_id, s.plays, s.captured_at
    FROM public.curator_deal_snapshots s
    WHERE s.deal_id = p_deal_id AND s.is_initial_capture = false
    ORDER BY s.playlist_id, s.captured_at DESC
  ),
  classified AS (
    SELECT l.playlist_id, l.plays, COALESCE(p.match_status, 'organic') AS match_status
    FROM latest l
    JOIN public.curator_playlists p ON p.id = l.playlist_id
    WHERE p.is_baseline = false
      AND COALESCE(p.is_observational, false) = false
  ),
  agg AS (
    SELECT match_status, COUNT(*)::int AS playlists, COALESCE(SUM(plays),0)::bigint AS plays
    FROM classified GROUP BY match_status
  )
  SELECT jsonb_build_object(
    'curator', jsonb_build_object(
      'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='curator'),0),
      'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='curator'),0)
    ),
    'ecosystem', jsonb_build_object(
      'editorial', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='editorial'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='editorial'),0)
      ),
      'algorithmic', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='algorithmic'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='algorithmic'),0)
      ),
      'organic', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='organic'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='organic'),0)
      ),
      'suspicious', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='suspicious'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='suspicious'),0)
      )
    ),
    'total', jsonb_build_object(
      'playlists', COALESCE((SELECT SUM(playlists) FROM agg),0),
      'plays',     COALESCE((SELECT SUM(plays)     FROM agg),0)
    ),
    'baseline_plays', v_baseline,
    'target_plays',   v_target
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- 5) get_curator_deal_progress — usa is_initial_capture nas snapshots
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
    SELECT s.song_id, s.playlist_id, s.plays, s.captured_at, s.is_initial_capture,
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
                   AND s2.playlist_id = a.playlist_id AND s2.is_initial_capture
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

  v_engine := COALESCE(public.fn_deal_delivery_accumulated(p_deal_id), 0);
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

-- 6) get_curator_deal_snapshot_history — coluna nas snapshots renomeada; logs mantêm is_baseline.
-- O JSON de saída passa a usar 'is_initial_capture' (consumidores atualizados).
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
        (SELECT bool_or(s.is_initial_capture) FROM snaps s WHERE s.bucket = b.bucket),
        false
      ) OR COALESCE(
        (SELECT bool_or(l.is_baseline) FROM logs l WHERE l.bucket = b.bucket),
        false
      ) AS is_initial_capture,
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
      'is_initial_capture', bm.is_initial_capture,
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
            WHEN COALESCE((entry->>'is_initial_capture')::boolean, false)
              THEN 'initial:' || COALESCE(entry->>'captured_at', random()::text)
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

-- 7) recompute_curator_deal_state
CREATE OR REPLACE FUNCTION public.recompute_curator_deal_state(p_deal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_closed_at timestamptz;
  v_closed_status text;
  v_has_curator_pl boolean;
  v_has_snapshot boolean;
  v_new_state text;
  v_old_state text;
BEGIN
  SELECT closed_at, closed_status, state INTO v_closed_at, v_closed_status, v_old_state
    FROM public.curator_deals WHERE id = p_deal_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_closed_at IS NOT NULL THEN
    v_new_state := CASE WHEN v_closed_status = 'completed' THEN 'completed' ELSE 'closed' END;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM public.curator_playlists
       WHERE deal_id = p_deal_id AND match_status = 'curator'
         AND COALESCE(is_observational, false) = false
    ) INTO v_has_curator_pl;

    IF NOT v_has_curator_pl THEN
      v_new_state := 'awaiting_playlists';
    ELSE
      SELECT EXISTS(
        SELECT 1 FROM public.curator_deal_snapshots s
         JOIN public.curator_playlists p ON p.id = s.playlist_id
         WHERE s.deal_id = p_deal_id
           AND p.match_status = 'curator'
           AND COALESCE(p.is_observational, false) = false
           AND s.is_initial_capture = false
      ) INTO v_has_snapshot;
      v_new_state := CASE WHEN v_has_snapshot THEN 'active' ELSE 'collecting' END;
    END IF;
  END IF;

  UPDATE public.curator_deals
     SET state = v_new_state
   WHERE id = p_deal_id AND state IS DISTINCT FROM v_new_state
     AND state <> 'paused';

  IF v_new_state = 'collecting' AND v_old_state IS DISTINCT FROM 'collecting' THEN
    UPDATE public.curator_deal_songs
       SET next_auto_collect_at = now()
     WHERE deal_id = p_deal_id
       AND auto_collect = true
       AND auto_collect_status IN ('idle', 'error')
       AND (next_auto_collect_at IS NULL OR next_auto_collect_at > now());
  END IF;
END;
$function$;

-- 8) record_curator_deal_capture — só o INSERT em curator_deal_snapshots usa o novo nome
CREATE OR REPLACE FUNCTION public.record_curator_deal_capture(p_deal_id uuid, p_song_id uuid, p_total_plays bigint, p_is_baseline boolean, p_note text, p_print_urls text[], p_new_playlists jsonb, p_snapshots jsonb, p_captured_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid;
  v_deal_owner uuid;
  v_log_id uuid;
  v_inserted_playlists int := 0;
  v_inserted_snapshots int := 0;
  v_skipped_snapshots int := 0;
  v_pl jsonb;
  v_snap jsonb;
  v_playlist_id uuid;
  v_match_method text;
  v_spotify_id text;
  v_normalized_name text;
  v_plays bigint;
  v_fuzzy_score real;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_deal_owner FROM public.curator_deals WHERE id = p_deal_id;
  IF v_deal_owner IS NULL THEN
    RAISE EXCEPTION 'deal not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_deal_owner <> v_user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_song_id IS NOT NULL THEN
    PERFORM 1 FROM public.curator_deal_songs
      WHERE id = p_song_id AND deal_id = p_deal_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'song does not belong to deal' USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.curator_deal_logs (deal_id, total_plays, note, is_baseline, print_urls, song_id)
  VALUES (
    p_deal_id, GREATEST(p_total_plays, 0), NULLIF(p_note, ''),
    COALESCE(p_is_baseline, false),
    COALESCE(p_print_urls, ARRAY[]::text[]),
    p_song_id
  )
  RETURNING id INTO v_log_id;

  IF p_new_playlists IS NOT NULL AND jsonb_typeof(p_new_playlists) = 'array' THEN
    FOR v_pl IN SELECT * FROM jsonb_array_elements(p_new_playlists) LOOP
      INSERT INTO public.curator_playlists (
        deal_id, song_id, spotify_url, playlist_name, followers, is_baseline
      )
      VALUES (
        p_deal_id, p_song_id,
        COALESCE(v_pl->>'spotify_url', ''),
        v_pl->>'playlist_name',
        NULLIF(v_pl->>'followers','')::bigint,
        COALESCE((v_pl->>'is_baseline')::boolean, COALESCE(p_is_baseline, false))
      );
      v_inserted_playlists := v_inserted_playlists + 1;
    END LOOP;
  END IF;

  IF p_snapshots IS NOT NULL AND jsonb_typeof(p_snapshots) = 'array' THEN
    FOR v_snap IN SELECT * FROM jsonb_array_elements(p_snapshots) LOOP
      v_playlist_id := NULL;
      v_match_method := NULL;
      v_spotify_id := public.extract_spotify_playlist_id(v_snap->>'spotify_url');
      v_plays := GREATEST(COALESCE((v_snap->>'plays')::bigint, 0), 0);

      IF v_spotify_id IS NOT NULL THEN
        SELECT id INTO v_playlist_id
          FROM public.curator_playlists
         WHERE deal_id = p_deal_id AND spotify_playlist_id = v_spotify_id
         LIMIT 1;
        IF v_playlist_id IS NOT NULL THEN v_match_method := 'spotify_id'; END IF;
      END IF;

      IF v_playlist_id IS NULL AND (v_snap->>'playlist_name') IS NOT NULL THEN
        v_normalized_name := trim(lower(regexp_replace(
          translate(v_snap->>'playlist_name',
            'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
            'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
          '[^a-zA-Z0-9]+', ' ', 'g'
        )));

        SELECT id INTO v_playlist_id
          FROM public.curator_playlists
         WHERE deal_id = p_deal_id
           AND trim(lower(regexp_replace(
             translate(playlist_name,
               'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
               'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
             '[^a-zA-Z0-9]+', ' ', 'g'
           ))) = v_normalized_name
         ORDER BY (is_baseline = COALESCE(p_is_baseline, false)) DESC
         LIMIT 1;
        IF v_playlist_id IS NOT NULL THEN v_match_method := 'name'; END IF;

        IF v_playlist_id IS NULL THEN
          SELECT id, similarity(
            trim(lower(regexp_replace(
              translate(playlist_name,
                'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
              '[^a-zA-Z0-9]+', ' ', 'g'
            ))),
            v_normalized_name
          )
          INTO v_playlist_id, v_fuzzy_score
            FROM public.curator_playlists
           WHERE deal_id = p_deal_id
           ORDER BY 2 DESC
           LIMIT 1;

          IF v_playlist_id IS NOT NULL AND COALESCE(v_fuzzy_score, 0) >= 0.6 THEN
            v_match_method := 'fuzzy';
          ELSE
            v_playlist_id := NULL;
          END IF;
        END IF;
      END IF;

      IF v_playlist_id IS NULL THEN
        v_skipped_snapshots := v_skipped_snapshots + 1;
        CONTINUE;
      END IF;

      INSERT INTO public.curator_deal_snapshots (
        deal_id, song_id, playlist_id, plays, captured_at,
        print_url, is_initial_capture, source, ai_confidence, created_by, match_method
      )
      VALUES (
        p_deal_id, p_song_id, v_playlist_id, v_plays,
        COALESCE(p_captured_at, now()),
        NULLIF(v_snap->>'print_url',''),
        COALESCE(p_is_baseline, false),
        COALESCE(NULLIF(v_snap->>'source',''), 'spotify_for_artists'),
        NULLIF(v_snap->>'ai_confidence','')::numeric,
        v_user_id,
        v_match_method
      );
      v_inserted_snapshots := v_inserted_snapshots + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'log_id', v_log_id,
    'inserted_playlists', v_inserted_playlists,
    'inserted_snapshots', v_inserted_snapshots,
    'skipped_snapshots', v_skipped_snapshots
  );
END;
$function$;

-- 9) sync_curator_playlist_streams_from_snapshot trigger function — usa is_initial_capture
CREATE OR REPLACE FUNCTION public.sync_curator_playlist_streams_from_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_initial_capture = true THEN
    RETURN NEW;
  END IF;
  UPDATE public.curator_playlists
     SET streams_7d    = COALESCE(NEW.plays_7d,  streams_7d),
         streams_28d   = COALESCE(NEW.plays_28d, streams_28d),
         streams_total = GREATEST(COALESCE(streams_total, 0), COALESCE(NEW.plays, 0))
   WHERE id = NEW.playlist_id;
  RETURN NEW;
END;
$function$;

COMMENT ON COLUMN public.curator_deal_snapshots.is_initial_capture IS
  'Fase 1.A.2 (renomeada de is_baseline). Marca o primeiro snapshot de medição de plays por (deal, song, playlist). "Baseline" agora refere-se exclusivamente à fotografia inicial da campanha em campaign_playlist_collections.';
