DO $$
DECLARE
  v_campaign_id uuid := '898dc93e-b2e5-478f-b288-72f86bbf6ca7';
  v_days integer;
  v_streams_eco integer;
  v_status text;
  v_eco_dispatched_at timestamptz;
BEGIN
  SELECT
    GREATEST(1, COALESCE((simulation_snapshot->>'days')::int, 1)),
    GREATEST(0, COALESCE((simulation_snapshot->>'streamsEco')::int, goal_plays, 0)),
    status,
    eco_dispatched_at
  INTO v_days, v_streams_eco, v_status, v_eco_dispatched_at
  FROM public.campaigns
  WHERE id = v_campaign_id;

  IF v_streams_eco IS NULL THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  IF v_eco_dispatched_at IS NOT NULL OR v_status NOT IN ('draft', 'paused') THEN
    RAISE EXCEPTION 'campaign_already_dispatched_or_not_editable';
  END IF;

  DELETE FROM public.campaign_eco_allocations
  WHERE campaign_id = v_campaign_id;

  WITH candidates AS (
    SELECT
      mp.id AS playlist_id,
      GREATEST(1, COALESCE(mp.followers, 0)) AS followers,
      GREATEST(1, ROUND(GREATEST(1, COALESCE(mp.followers, 0)) * 0.08 * v_days))::int AS capacity
    FROM public.managed_playlists mp
    WHERE mp.id IN (
      SELECT DISTINCT managed_playlist_id
      FROM public.campaign_eco_allocations
      WHERE campaign_id = v_campaign_id
    )
  ), selected AS (
    SELECT
      playlist_id,
      followers,
      capacity,
      SUM(capacity) OVER (ORDER BY followers DESC ROWS UNBOUNDED PRECEDING) AS running_capacity,
      COALESCE(SUM(capacity) OVER (ORDER BY followers DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prev_capacity,
      ROW_NUMBER() OVER (ORDER BY followers DESC) AS rn
    FROM candidates
  ), needed AS (
    SELECT *
    FROM selected
    WHERE prev_capacity < v_streams_eco
  ), priced AS (
    SELECT
      COALESCE(MAX(cost_per_stream_op), 0) AS cost_per_stream_op,
      COALESCE(MAX(market_per_stream), 0) AS market_per_stream,
      COALESCE(MAX(price_per_stream_sell), 0) AS price_per_stream_sell
    FROM public.campaign_eco_allocations
    WHERE campaign_id = v_campaign_id
  )
  INSERT INTO public.campaign_eco_allocations (
    campaign_id,
    managed_playlist_id,
    planned_streams,
    start_day,
    status,
    cost_per_stream_op,
    market_per_stream,
    price_per_stream_sell
  )
  SELECT
    v_campaign_id,
    n.playlist_id,
    CASE
      WHEN n.rn = (SELECT MAX(rn) FROM needed) THEN GREATEST(0, v_streams_eco - n.prev_capacity)::int
      ELSE LEAST(n.capacity, ROUND((n.capacity::numeric / NULLIF((SELECT SUM(capacity) FROM needed), 0)) * v_streams_eco))::int
    END,
    1,
    'pending',
    p.cost_per_stream_op,
    p.market_per_stream,
    p.price_per_stream_sell
  FROM needed n
  CROSS JOIN priced p
  WHERE v_streams_eco > 0;

  UPDATE public.campaigns
  SET total_allocated = (
    SELECT COALESCE(SUM(planned_streams), 0)
    FROM public.campaign_eco_allocations
    WHERE campaign_id = v_campaign_id
  )
  WHERE id = v_campaign_id;
END $$;