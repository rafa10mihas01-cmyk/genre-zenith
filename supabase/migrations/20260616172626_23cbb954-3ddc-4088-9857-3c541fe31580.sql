CREATE OR REPLACE FUNCTION public.append_print_to_batch(
  p_batch_id     uuid,
  p_path         text,
  p_signed_url   text,
  p_dom          jsonb,
  p_correlation  uuid DEFAULT NULL
) RETURNS TABLE (
  batch_id       uuid,
  received_parts int,
  total_parts    int,
  is_complete    boolean,
  print_paths    jsonb,
  print_urls     jsonb,
  dom_payload    jsonb,
  status         text,
  was_duplicate  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row         bot_print_batches%ROWTYPE;
  v_dup         boolean := false;
  v_complete    boolean := false;
  v_paths       jsonb;
  v_urls        jsonb;
  v_dom         jsonb;
  v_received    int;
  v_status      text;
  v_completed_at timestamptz;
BEGIN
  -- Lock pessimista: serializa requests concorrentes sobre o mesmo batch.
  SELECT * INTO v_row FROM public.bot_print_batches
   WHERE id = p_batch_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch_not_found: %', p_batch_id;
  END IF;

  -- Batch já em estado terminal → idempotente, devolve estado atual.
  IF v_row.status IN ('complete','processed','error') THEN
    RETURN QUERY SELECT
      v_row.id, v_row.received_parts, v_row.total_parts,
      true, v_row.print_paths, v_row.print_urls, v_row.dom_payload,
      v_row.status, true;
    RETURN;
  END IF;

  -- Idempotência: se o path já estiver registrado, não conta de novo.
  IF v_row.print_paths @> to_jsonb(p_path) THEN
    v_dup := true;
    v_paths    := v_row.print_paths;
    v_urls     := v_row.print_urls;
    v_received := v_row.received_parts;
  ELSE
    v_paths    := COALESCE(v_row.print_paths, '[]'::jsonb) || to_jsonb(p_path);
    v_urls     := COALESCE(v_row.print_urls,  '[]'::jsonb) || to_jsonb(p_signed_url);
    v_received := COALESCE(v_row.received_parts, 0) + 1;
  END IF;

  -- Merge dom_payload deduplicando por url.
  WITH merged AS (
    SELECT x FROM jsonb_array_elements(
      COALESCE(v_row.dom_payload,'[]'::jsonb) || COALESCE(p_dom,'[]'::jsonb)
    ) AS x
  ), dedup AS (
    SELECT DISTINCT ON (COALESCE(x->>'url', x::text)) x
    FROM merged
  )
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_dom FROM dedup;

  v_complete := v_received >= v_row.total_parts;
  v_status := CASE WHEN v_complete THEN 'complete' ELSE 'pending' END;
  v_completed_at := CASE WHEN v_complete THEN now() ELSE NULL END;

  UPDATE public.bot_print_batches SET
    print_paths    = v_paths,
    print_urls     = v_urls,
    received_parts = v_received,
    dom_payload    = v_dom,
    status         = v_status,
    completed_at   = v_completed_at,
    correlation_id = COALESCE(p_correlation, correlation_id)
  WHERE id = p_batch_id;

  RETURN QUERY SELECT
    p_batch_id, v_received, v_row.total_parts,
    v_complete, v_paths, v_urls, v_dom, v_status, v_dup;
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_print_to_batch(uuid,text,text,jsonb,uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.append_print_to_batch(uuid,text,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;