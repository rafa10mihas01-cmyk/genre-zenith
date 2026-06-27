CREATE OR REPLACE FUNCTION public.ingest_campaign_collection_batch(
  p_campaign_id uuid,
  p_intent text,
  p_rows jsonb,
  p_snapshot_run_id uuid DEFAULT NULL::uuid,
  p_upload_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
     snapshot_run_id, upload_id)
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
    p_snapshot_run_id,
    p_upload_id
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
    'upload_id', p_upload_id,
    'rows_received', v_rows_count,
    'rows_inserted', v_inserted
  );
END;
$function$;