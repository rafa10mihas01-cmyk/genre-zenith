-- Estende get_curator_deal_progress: agora também retorna baseline/latest totais,
-- progresso %, ETA em dias e baseline/latest por playlist.
-- Cria get_curator_deal_snapshot_history para histórico cronológico.

DROP FUNCTION IF EXISTS public.get_curator_deal_progress(uuid);

CREATE OR REPLACE FUNCTION public.get_curator_deal_progress(p_deal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_target bigint := 0;
  v_daily_goal bigint := 0;
BEGIN
  SELECT COALESCE(target_plays, 0), COALESCE(daily_goal, 0)
    INTO v_target, v_daily_goal
  FROM public.curator_deals
  WHERE id = p_deal_id;

  WITH ordered AS (
    SELECT
      s.playlist_id,
      s.plays,
      s.captured_at,
      s.is_baseline,
      LAG(s.plays) OVER (PARTITION BY s.playlist_id ORDER BY s.captured_at) AS prev_plays
    FROM public.curator_deal_snapshots s
    WHERE s.deal_id = p_deal_id
  ),
  deltas AS (
    SELECT
      o.playlist_id,
      o.plays,
      GREATEST(o.plays - COALESCE(o.prev_plays, 0), 0) AS delivered,
      o.captured_at,
      o.is_baseline,
      o.prev_plays IS NULL AS is_first
    FROM ordered o
  ),
  per_playlist AS (
    SELECT
      d.playlist_id,
      cp.playlist_name,
      cp.is_baseline AS playlist_is_baseline,
      MIN(d.plays) FILTER (WHERE d.is_first) AS baseline_plays,
      (SELECT plays FROM public.curator_deal_snapshots
        WHERE deal_id = p_deal_id AND playlist_id = d.playlist_id
        ORDER BY captured_at DESC LIMIT 1) AS latest_plays,
      SUM(CASE WHEN d.is_first THEN 0 ELSE d.delivered END) AS delivered,
      MAX(d.captured_at) AS last_captured_at,
      COUNT(*) FILTER (WHERE NOT d.is_first) AS snapshot_count
    FROM deltas d
    LEFT JOIN public.curator_playlists cp ON cp.id = d.playlist_id
    GROUP BY d.playlist_id, cp.playlist_name, cp.is_baseline
  ),
  totals AS (
    SELECT
      COALESCE(SUM(delivered) FILTER (WHERE NOT playlist_is_baseline), 0) AS delivered_curator,
      COALESCE(SUM(delivered), 0) AS delivered_total,
      COALESCE(SUM(baseline_plays) FILTER (WHERE NOT playlist_is_baseline), 0) AS baseline_curator,
      COALESCE(SUM(latest_plays) FILTER (WHERE NOT playlist_is_baseline), 0) AS latest_curator
    FROM per_playlist
  ),
  range_info AS (
    SELECT
      MIN(captured_at) AS first_capture,
      MAX(captured_at) AS last_capture
    FROM public.curator_deal_snapshots
    WHERE deal_id = p_deal_id
  )
  SELECT jsonb_build_object(
    'deal_id', p_deal_id,
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
    )
  )
  INTO v_result
  FROM totals t CROSS JOIN range_info r;

  RETURN COALESCE(v_result, jsonb_build_object(
    'deal_id', p_deal_id,
    'target_plays', v_target,
    'daily_goal', v_daily_goal,
    'baseline_total', 0,
    'latest_total', 0,
    'delivered_curator', 0,
    'delivered_total', 0,
    'daily_avg', 0,
    'days_elapsed', 0,
    'progress_pct', 0,
    'eta_days', NULL,
    'per_playlist', '[]'::jsonb
  ));
END;
$function$;

-- Histórico cronológico de snapshots: agrupado por captured_at (rounded p/ minuto)
CREATE OR REPLACE FUNCTION public.get_curator_deal_snapshot_history(p_deal_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH grouped AS (
    SELECT
      date_trunc('minute', captured_at) AS bucket,
      MIN(captured_at) AS captured_at,
      bool_or(is_baseline) AS is_baseline,
      COUNT(DISTINCT playlist_id) AS playlists_count,
      SUM(plays) AS total_plays
    FROM public.curator_deal_snapshots
    WHERE deal_id = p_deal_id
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