CREATE OR REPLACE FUNCTION public.recalc_curator_deal_baseline_from_spreadsheet(p_deal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_collection_mode text;
  v_baseline_at timestamptz;
BEGIN
  SELECT campaign_id INTO v_campaign_id FROM public.curator_deals WHERE id = p_deal_id;
  IF v_campaign_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'deal_sem_campanha');
  END IF;

  SELECT collection_mode, baseline_captured_at
    INTO v_collection_mode, v_baseline_at
    FROM public.campaigns WHERE id = v_campaign_id;

  IF v_collection_mode IS DISTINCT FROM 'spreadsheet' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'campanha_nao_e_planilha');
  END IF;

  IF v_baseline_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'baseline_da_campanha_ausente');
  END IF;

  UPDATE public.curator_deals
     SET baseline_captured_at = v_baseline_at,
         baseline_plays = NULL,
         state = 'collecting'
   WHERE id = p_deal_id;

  RETURN jsonb_build_object('ok', true, 'baseline_captured_at', v_baseline_at);
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_curator_deal_baseline_from_spreadsheet(uuid) TO authenticated, service_role;