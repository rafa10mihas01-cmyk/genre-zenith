CREATE OR REPLACE FUNCTION public.sync_deal_campaign_baseline(p_deal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_campaign_id uuid;
  v_baseline_at timestamptz;
  v_baseline_reference_date date;
BEGIN
  SELECT d.campaign_id INTO v_campaign_id
  FROM public.curator_deals d
  WHERE d.id = p_deal_id;

  IF v_campaign_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'deal_without_campaign');
  END IF;

  SELECT c.baseline_captured_at, c.baseline_reference_date
    INTO v_baseline_at, v_baseline_reference_date
  FROM public.campaigns c
  WHERE c.id = v_campaign_id
    AND c.baseline_status = 'captured';

  IF v_baseline_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'campaign_baseline_not_captured');
  END IF;

  UPDATE public.curator_deals d
     SET baseline_captured_at = COALESCE(d.baseline_captured_at, v_baseline_at),
         baseline_reference_date = COALESCE(d.baseline_reference_date, v_baseline_reference_date)
   WHERE d.id = p_deal_id;

  RETURN jsonb_build_object(
    'ok', true,
    'campaign_id', v_campaign_id,
    'deal_id', p_deal_id,
    'baseline_captured_at', v_baseline_at,
    'baseline_reference_date', v_baseline_reference_date
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