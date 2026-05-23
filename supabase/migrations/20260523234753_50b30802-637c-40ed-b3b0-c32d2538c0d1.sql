DO $$
DECLARE
  v_campaign_id uuid := '898dc93e-b2e5-478f-b288-72f86bbf6ca7';
  v_streams_eco integer;
  v_status text;
  v_eco_dispatched_at timestamptz;
  v_playlist_id uuid;
  v_price_per_stream_sell numeric := 0;
BEGIN
  SELECT
    GREATEST(0, COALESCE((simulation_snapshot->>'streamsEco')::int, goal_plays, 0)),
    status,
    eco_dispatched_at,
    COALESCE((simulation_snapshot->>'pricePerStreamSell')::numeric, 0)
  INTO v_streams_eco, v_status, v_eco_dispatched_at, v_price_per_stream_sell
  FROM public.campaigns
  WHERE id = v_campaign_id;

  IF v_streams_eco IS NULL THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  IF v_eco_dispatched_at IS NOT NULL OR v_status NOT IN ('draft', 'paused') THEN
    RAISE EXCEPTION 'campaign_already_dispatched_or_not_editable';
  END IF;

  SELECT id INTO v_playlist_id
  FROM public.managed_playlists
  ORDER BY COALESCE(followers, 0) DESC
  LIMIT 1;

  IF v_playlist_id IS NULL THEN
    RAISE EXCEPTION 'no_managed_playlist_available';
  END IF;

  DELETE FROM public.campaign_eco_allocations
  WHERE campaign_id = v_campaign_id;

  INSERT INTO public.campaign_eco_allocations (
    campaign_id,
    managed_playlist_id,
    planned_streams,
    start_day,
    status,
    cost_per_stream_op,
    market_per_stream,
    price_per_stream_sell
  ) VALUES (
    v_campaign_id,
    v_playlist_id,
    v_streams_eco,
    1,
    'pending',
    0,
    0,
    v_price_per_stream_sell
  );

  UPDATE public.campaigns
  SET total_allocated = v_streams_eco
  WHERE id = v_campaign_id;
END $$;