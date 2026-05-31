
-- 1) Identificador único por execução de coleta
ALTER TABLE public.campaign_playlist_collections
  ADD COLUMN collection_run_id UUID;

CREATE INDEX idx_cpc_run_id ON public.campaign_playlist_collections (collection_run_id);

-- 2) RPC atômica + idempotente para o bot
CREATE OR REPLACE FUNCTION public.ingest_campaign_collection_batch(
  p_campaign_id UUID,
  p_intent TEXT,     -- 'baseline' | 'periodic'
  p_rows JSONB        -- array of { playlist_id, playlist_url, playlist_name_at_capture, plays_7d, proof_screenshot_url, source? }
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Lock da campanha pra serializar concorrência de baseline
  SELECT baseline_status INTO v_baseline_status
  FROM public.campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF v_baseline_status IS NULL THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  -- Idempotência da baseline: se já capturada, ignora segundo disparo
  IF p_intent = 'baseline' AND v_baseline_status = 'captured' THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'baseline_already_captured',
      'campaign_id', p_campaign_id
    );
  END IF;

  v_is_baseline := (p_intent = 'baseline');

  -- Insert atômico de todas as linhas do lote (mesma transação da RPC)
  INSERT INTO public.campaign_playlist_collections
    (campaign_id, playlist_id, playlist_url, playlist_name_at_capture,
     plays_7d, captured_at, is_baseline, source, proof_screenshot_url, collection_run_id)
  SELECT
    p_campaign_id,
    r->>'playlist_id',
    r->>'playlist_url',
    r->>'playlist_name_at_capture',
    COALESCE((r->>'plays_7d')::BIGINT, 0),
    v_now,
    v_is_baseline,
    COALESCE(r->>'source', 's4a_dom'),
    r->>'proof_screenshot_url',
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
$$;

REVOKE ALL ON FUNCTION public.ingest_campaign_collection_batch(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_campaign_collection_batch(UUID, TEXT, JSONB) TO service_role;
