CREATE OR REPLACE FUNCTION public.sync_deal_campaign_baseline(p_deal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_campaign_id uuid;
  v_baseline_at timestamptz;
  v_inserted int := 0;
  v_song_count int := 0;
BEGIN
  SELECT d.campaign_id INTO v_campaign_id
  FROM public.curator_deals d
  WHERE d.id = p_deal_id;

  IF v_campaign_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'deal_without_campaign');
  END IF;

  SELECT c.baseline_captured_at INTO v_baseline_at
  FROM public.campaigns c
  WHERE c.id = v_campaign_id
    AND c.baseline_status = 'captured';

  IF v_baseline_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'campaign_baseline_not_captured');
  END IF;

  UPDATE public.curator_deals d
     SET baseline_captured_at = COALESCE(d.baseline_captured_at, v_baseline_at)
   WHERE d.id = p_deal_id;

  SELECT count(*)::int INTO v_song_count
  FROM public.curator_deal_songs s
  WHERE s.deal_id = p_deal_id;

  IF v_song_count > 0 THEN
    WITH baseline AS (
      SELECT DISTINCT ON (c.playlist_id)
             c.playlist_id,
             c.playlist_name_at_capture,
             c.captured_at
        FROM public.campaign_playlist_collections c
       WHERE c.campaign_id = v_campaign_id
         AND c.is_baseline = true
         AND COALESCE(c.excluded, false) = false
       ORDER BY c.playlist_id, c.captured_at DESC, c.created_at DESC
    ), inserted AS (
      INSERT INTO public.curator_deal_baseline_playlists
        (deal_id, song_id, spotify_playlist_id, playlist_name, captured_at)
      SELECT p_deal_id,
             s.id,
             b.playlist_id,
             b.playlist_name_at_capture,
             b.captured_at
        FROM public.curator_deal_songs s
        CROSS JOIN baseline b
       WHERE s.deal_id = p_deal_id
      ON CONFLICT (deal_id, song_id, spotify_playlist_id)
      WHERE song_id IS NOT NULL
      DO UPDATE SET
        playlist_name = EXCLUDED.playlist_name,
        captured_at = EXCLUDED.captured_at
      RETURNING 1
    )
    SELECT count(*)::int INTO v_inserted FROM inserted;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'campaign_id', v_campaign_id,
    'deal_id', p_deal_id,
    'baseline_captured_at', v_baseline_at,
    'songs', v_song_count,
    'rows_synced', v_inserted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_deal_campaign_baseline(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_campaign_deals_baseline(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_deals int := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.curator_deals WHERE campaign_id = p_campaign_id
  LOOP
    PERFORM public.sync_deal_campaign_baseline(r.id);
    v_deals := v_deals + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'deals_synced', v_deals);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_campaign_deals_baseline(uuid) TO authenticated, service_role;