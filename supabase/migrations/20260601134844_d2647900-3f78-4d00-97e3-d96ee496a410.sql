CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_campaign public.campaigns%ROWTYPE;
  v_deal_id uuid;
  v_baseline_count int;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;
  IF v_campaign.client_approved_at IS NULL THEN
    RAISE EXCEPTION 'client_approval_required'
      USING HINT = 'Compartilhe o link público com o cliente e aguarde a aprovação antes de aprovar internamente.';
  END IF;
  IF v_campaign.status NOT IN ('draft','paused') THEN
    RAISE EXCEPTION 'campaign_not_in_approvable_state' USING DETAIL = v_campaign.status;
  END IF;
  IF v_campaign.curator_id IS NULL THEN
    RAISE EXCEPTION 'curator_required';
  END IF;

  -- Campanhas que coletam dados via planilha (gravadora/label) exigem
  -- baseline do cliente antes da distribuição. Sem baseline, o sistema
  -- não consegue medir delta de entrega depois.
  IF v_campaign.collection_mode = 'spreadsheet' AND v_campaign.deal_id IS NOT NULL THEN
    SELECT count(*) INTO v_baseline_count
      FROM public.label_spreadsheet_uploads
     WHERE deal_id = v_campaign.deal_id
       AND is_baseline = true
       AND status = 'done';
    IF v_baseline_count = 0 THEN
      RAISE EXCEPTION 'baseline_required'
        USING HINT = 'Peça ao cliente para enviar a primeira planilha (baseline) no portal antes de distribuir a campanha.';
    END IF;
  END IF;

  INSERT INTO public.curator_deals (curator_id, contracted_plays, status, notes)
  VALUES (v_campaign.curator_id, v_campaign.goal_plays, 'active',
          'Auto-criado pela aprovação da campanha ' || v_campaign.track_name)
  RETURNING id INTO v_deal_id;
  UPDATE public.campaigns
     SET status = 'active',
         deal_id = COALESCE(deal_id, v_deal_id),
         snapshot_locked_at = COALESCE(snapshot_locked_at, now())
   WHERE id = p_campaign_id;
  RETURN jsonb_build_object('campaign_id', p_campaign_id, 'deal_id', v_deal_id);
END; $$;