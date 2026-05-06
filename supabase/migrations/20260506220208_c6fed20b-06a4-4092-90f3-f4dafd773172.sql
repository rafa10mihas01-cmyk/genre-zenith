
CREATE OR REPLACE FUNCTION public.get_curator_deal_breakdown(p_deal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_baseline bigint;
  v_target bigint;
  v_result jsonb;
BEGIN
  SELECT user_id, COALESCE(baseline_plays,0), COALESCE(target_plays,0)
    INTO v_owner, v_baseline, v_target
  FROM public.curator_deals
  WHERE id = p_deal_id;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('error','deal_not_found');
  END IF;

  IF v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (s.playlist_id)
      s.playlist_id,
      s.plays,
      s.captured_at
    FROM public.curator_deal_snapshots s
    WHERE s.deal_id = p_deal_id
      AND s.is_baseline = false
    ORDER BY s.playlist_id, s.captured_at DESC
  ),
  classified AS (
    SELECT
      l.playlist_id,
      l.plays,
      COALESCE(p.match_status, 'organic') AS match_status
    FROM latest l
    JOIN public.curator_playlists p ON p.id = l.playlist_id
    WHERE p.is_baseline = false
  ),
  agg AS (
    SELECT
      match_status,
      COUNT(*)::int AS playlists,
      COALESCE(SUM(plays),0)::bigint AS plays
    FROM classified
    GROUP BY match_status
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
$$;

GRANT EXECUTE ON FUNCTION public.get_curator_deal_breakdown(uuid) TO authenticated;
