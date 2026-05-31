-- 1) Nova coluna lista
ALTER TABLE public.campaign_playlist_collections
  ADD COLUMN IF NOT EXISTS proof_screenshot_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 2) Backfill: usar o print único existente como primeiro item da lista
UPDATE public.campaign_playlist_collections
   SET proof_screenshot_urls = ARRAY[proof_screenshot_url]
 WHERE proof_screenshot_url IS NOT NULL
   AND (proof_screenshot_urls IS NULL OR array_length(proof_screenshot_urls, 1) IS NULL);

-- 3) Atualizar a RPC pra aceitar e gravar a lista inteira (mantendo o campo único pro primeiro)
CREATE OR REPLACE FUNCTION public.ingest_campaign_collection_batch(
  p_campaign_id uuid, p_intent text, p_rows jsonb
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
     proof_screenshot_url, proof_screenshot_urls, collection_run_id)
  SELECT
    p_campaign_id,
    r->>'playlist_id',
    r->>'playlist_url',
    r->>'playlist_name_at_capture',
    COALESCE((r->>'plays_7d')::BIGINT, 0),
    v_now,
    v_is_baseline,
    COALESCE(r->>'source', 's4a_dom'),
    -- single (retrocompat): primeiro item da lista OU campo único OU null
    COALESCE(
      (CASE
        WHEN jsonb_typeof(r->'proof_screenshot_urls') = 'array'
             AND jsonb_array_length(r->'proof_screenshot_urls') > 0
        THEN (r->'proof_screenshot_urls'->>0)
      END),
      r->>'proof_screenshot_url'
    ),
    -- array completo
    COALESCE(
      CASE
        WHEN jsonb_typeof(r->'proof_screenshot_urls') = 'array'
        THEN ARRAY(
          SELECT jsonb_array_elements_text(r->'proof_screenshot_urls')
        )
      END,
      CASE
        WHEN r->>'proof_screenshot_url' IS NOT NULL
        THEN ARRAY[r->>'proof_screenshot_url']
        ELSE ARRAY[]::TEXT[]
      END
    ),
    v_run_id
  FROM jsonb_array_elements(p_rows) r
  WHERE r->>'playlist_id' IS NOT NULL
    AND length(trim(r->>'playlist_id')) > 0;

  IF v_is_baseline THEN
    UPDATE public.campaigns
       SET baseline_status = 'captured',
           baseline_captured_at = v_now
     WHERE id = p_campaign_id;
  END IF;

  RETURN jsonb_build_object(
    'skipped', false,
    'collection_run_id', v_run_id,
    'is_baseline', v_is_baseline,
    'rows_received', v_rows_count,
    'captured_at', v_now
  );
END;
$function$;