CREATE OR REPLACE FUNCTION public.evaluate_upload_quarantine(p_deal_id uuid, p_content_hash text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dup_id uuid;
  v_total_rows int := 0;
  v_matched_rows int := 0;
  v_new_total bigint := 0;
  v_last_upload uuid;
BEGIN
  -- 1) Duplicata exata (mesmo hash de conteúdo) → rejeita
  IF p_content_hash IS NOT NULL THEN
    SELECT id INTO v_dup_id FROM label_spreadsheet_uploads
     WHERE deal_id = p_deal_id
       AND content_hash = p_content_hash
       AND quarantined_at IS NULL
     LIMIT 1;
    IF v_dup_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'decision','reject',
        'reason','duplicate_content',
        'duplicate_of', v_dup_id
      );
    END IF;
  END IF;

  -- 2) Arquivo vazio / sem nenhuma linha → rejeita
  v_total_rows := COALESCE(jsonb_array_length(p_rows), 0);
  IF v_total_rows = 0 THEN
    RETURN jsonb_build_object(
      'decision','reject',
      'reason','empty_file'
    );
  END IF;

  -- 3) Nenhuma playlist com spotify_id válido → rejeita
  SELECT COUNT(*)::int, COALESCE(SUM((x->>'streams')::bigint), 0)
    INTO v_matched_rows, v_new_total
    FROM jsonb_array_elements(p_rows) x
   WHERE x->>'playlist_spotify_id' IS NOT NULL
     AND length(x->>'playlist_spotify_id') > 0;

  IF v_matched_rows = 0 THEN
    RETURN jsonb_build_object(
      'decision','reject',
      'reason','no_valid_playlists'
    );
  END IF;

  -- 4) Tudo certo. Identifica se é baseline (primeiro upload) ou periódico.
  --    Comparações de totais/ratios foram REMOVIDAS: a integridade do histórico
  --    é garantida pelo cálculo de entrega (delta positivo acumulado desde
  --    a baseline de cada playlist em fn_curator_delivery_accumulated). Janela
  --    diferente do S4A não compromete o resultado e não deve quarentenar.
  SELECT id INTO v_last_upload FROM label_spreadsheet_uploads
   WHERE deal_id = p_deal_id
     AND quarantined_at IS NULL
     AND status = 'imported'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_last_upload IS NULL THEN
    RETURN jsonb_build_object(
      'decision','accept',
      'mode','baseline',
      'reason','first_upload',
      'signals', jsonb_build_object(
        'rows', v_total_rows,
        'matched_rows', v_matched_rows,
        'new_total', v_new_total
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'decision','accept',
    'mode','periodic',
    'reason','ok',
    'window_kind','any',
    'signals', jsonb_build_object(
      'rows', v_total_rows,
      'matched_rows', v_matched_rows,
      'new_total', v_new_total,
      'last_upload', v_last_upload
    )
  );
END;
$function$;