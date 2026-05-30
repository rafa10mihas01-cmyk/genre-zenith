-- Reverte approve_campaign para versão sem gate de baseline.
-- Mantém idempotência (já ativa → ok) mas remove RAISE EXCEPTION 'baseline_required'.

CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign campaigns%ROWTYPE;
  v_deal_id uuid;
BEGIN
  SELECT * INTO v_campaign FROM campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotente: se já ativa, retorna ok.
  IF v_campaign.status = 'active' THEN
    RETURN jsonb_build_object('ok', true, 'already_active', true, 'campaign_id', p_campaign_id, 'deal_id', v_campaign.deal_id);
  END IF;

  IF v_campaign.status NOT IN ('draft','awaiting_internal','awaiting_client') THEN
    RAISE EXCEPTION 'invalid_status_for_approval: %', v_campaign.status;
  END IF;

  v_deal_id := v_campaign.deal_id;

  -- Se houver deal vinculado e ainda não estiver ativo, ativa direto.
  IF v_deal_id IS NOT NULL THEN
    UPDATE curator_deals
       SET state = 'active',
           updated_at = now()
     WHERE id = v_deal_id
       AND state IN ('awaiting_baseline','awaiting_playlists','collecting');
  END IF;

  UPDATE campaigns
     SET status = 'active',
         started_at = COALESCE(started_at, now()),
         updated_at = now()
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'deal_id', v_deal_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_campaign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_campaign(uuid) TO authenticated, service_role;