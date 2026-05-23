DO $$
DECLARE
  v_campaign_id uuid := '898dc93e-b2e5-478f-b288-72f86bbf6ca7';
  v_status text;
  v_eco_dispatched_at timestamptz;
  v_playlist_id uuid;
BEGIN
  SELECT status, eco_dispatched_at
  INTO v_status, v_eco_dispatched_at
  FROM public.campaigns
  WHERE id = v_campaign_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  IF v_eco_dispatched_at IS NOT NULL OR v_status NOT IN ('draft', 'paused') THEN
    RAISE EXCEPTION 'campaign_already_dispatched_or_not_editable';
  END IF;

  SELECT mp.id INTO v_playlist_id
  FROM public.managed_playlists mp
  JOIN public.genres g ON g.id = mp.genre_id
  WHERE g.slug = 'trap' OR lower(g.nome) LIKE '%trap%'
  ORDER BY COALESCE(mp.followers, 0) DESC
  LIMIT 1;

  IF v_playlist_id IS NULL THEN
    RAISE EXCEPTION 'no_compatible_playlist_available';
  END IF;

  UPDATE public.campaign_eco_allocations
  SET managed_playlist_id = v_playlist_id,
      planned_streams = 1000,
      start_day = 1,
      status = 'pending'
  WHERE campaign_id = v_campaign_id;

  UPDATE public.campaigns
  SET total_allocated = 1000
  WHERE id = v_campaign_id;
END $$;