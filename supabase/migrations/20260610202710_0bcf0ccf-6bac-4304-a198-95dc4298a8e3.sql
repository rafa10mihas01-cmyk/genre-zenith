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

CREATE OR REPLACE FUNCTION public.tg_sync_deal_campaign_baseline_from_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL THEN
    PERFORM public.sync_deal_campaign_baseline(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_deal_campaign_baseline_from_deal ON public.curator_deals;
CREATE TRIGGER trg_sync_deal_campaign_baseline_from_deal
AFTER INSERT OR UPDATE OF campaign_id ON public.curator_deals
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_deal_campaign_baseline_from_deal();

CREATE OR REPLACE FUNCTION public.tg_sync_deal_campaign_baseline_from_song()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.sync_deal_campaign_baseline(NEW.deal_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_deal_campaign_baseline_from_song ON public.curator_deal_songs;
CREATE TRIGGER trg_sync_deal_campaign_baseline_from_song
AFTER INSERT ON public.curator_deal_songs
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_deal_campaign_baseline_from_song();

CREATE OR REPLACE FUNCTION public.ingest_campaign_collection_batch(p_campaign_id uuid, p_intent text, p_rows jsonb, p_snapshot_run_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id UUID := gen_random_uuid();
  v_baseline_status TEXT;
  v_is_baseline BOOLEAN;
  v_now TIMESTAMPTZ := now();
  v_rows_count INT;
  v_inserted INT;
BEGIN
  IF p_intent NOT IN ('baseline','periodic') THEN
    RAISE EXCEPTION 'invalid_intent: must be baseline or periodic';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'invalid_rows: expected jsonb array';
  END IF;

  v_rows_count := jsonb_array_length(p_rows);

  SELECT baseline_status INTO v_baseline_status
  FROM public.campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF v_baseline_status IS NULL THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  IF p_intent = 'baseline' AND v_baseline_status = 'captured' THEN
    PERFORM public.sync_campaign_deals_baseline(p_campaign_id);
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'baseline_already_captured',
      'campaign_id', p_campaign_id
    );
  END IF;

  v_is_baseline := (p_intent = 'baseline');

  INSERT INTO public.campaign_playlist_collections
    (campaign_id, playlist_id, playlist_url, playlist_name_at_capture,
     plays_7d, captured_at, is_baseline, source,
     proof_screenshot_url, proof_screenshot_urls, collection_run_id,
     snapshot_run_id)
  SELECT
    p_campaign_id,
    r->>'playlist_id',
    r->>'playlist_url',
    r->>'playlist_name_at_capture',
    COALESCE((r->>'plays_7d')::BIGINT, 0),
    v_now,
    v_is_baseline,
    COALESCE(r->>'source', 's4a_dom'),
    CASE WHEN p_snapshot_run_id IS NOT NULL THEN NULL
      ELSE COALESCE(
        (CASE
          WHEN jsonb_typeof(r->'proof_screenshot_urls') = 'array'
               AND jsonb_array_length(r->'proof_screenshot_urls') > 0
          THEN (r->'proof_screenshot_urls'->>0)
        END),
        r->>'proof_screenshot_url'
      )
    END,
    CASE WHEN p_snapshot_run_id IS NOT NULL THEN ARRAY[]::TEXT[]
      ELSE COALESCE(
        CASE
          WHEN jsonb_typeof(r->'proof_screenshot_urls') = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(r->'proof_screenshot_urls'))
        END,
        CASE
          WHEN r->>'proof_screenshot_url' IS NOT NULL
          THEN ARRAY[r->>'proof_screenshot_url']
          ELSE ARRAY[]::TEXT[]
        END
      )
    END,
    v_run_id,
    p_snapshot_run_id
  FROM jsonb_array_elements(p_rows) r
  WHERE r->>'playlist_id' IS NOT NULL
    AND length(trim(r->>'playlist_id')) > 0;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_is_baseline AND v_inserted > 0 THEN
    UPDATE public.campaigns
       SET baseline_status = 'captured',
           baseline_captured_at = v_now,
           updated_at = v_now
     WHERE id = p_campaign_id;

    PERFORM public.sync_campaign_deals_baseline(p_campaign_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'campaign_id', p_campaign_id,
    'intent', p_intent,
    'collection_run_id', v_run_id,
    'snapshot_run_id', p_snapshot_run_id,
    'rows_received', v_rows_count,
    'rows_inserted', v_inserted
  );
END;
$$;

SELECT public.sync_campaign_deals_baseline('1f609379-a130-4bb8-92e8-46dcaac8ffff'::uuid);