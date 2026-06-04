
-- 1) Função única de enfileiramento de baseline
CREATE OR REPLACE FUNCTION public.enqueue_baseline_collection(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
  v_songs_updated int := 0;
BEGIN
  SELECT deal_id INTO v_deal_id
    FROM public.campaigns
   WHERE id = p_campaign_id
   FOR UPDATE;

  IF v_deal_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_deal_linked', 'campaign_id', p_campaign_id);
  END IF;

  UPDATE public.curator_deal_songs
     SET auto_collect          = true,
         auto_collect_status   = 'pending',
         auto_collect_error    = NULL,
         next_auto_collect_at  = now(),
         queued_at             = COALESCE(queued_at, now())
   WHERE deal_id = v_deal_id;
  GET DIAGNOSTICS v_songs_updated = ROW_COUNT;

  UPDATE public.campaigns
     SET baseline_status = COALESCE(baseline_status, 'pending')
   WHERE id = p_campaign_id
     AND (baseline_status IS NULL OR baseline_status = 'pending');

  RETURN jsonb_build_object(
    'ok', true,
    'campaign_id', p_campaign_id,
    'deal_id', v_deal_id,
    'songs_enqueued', v_songs_updated,
    'enqueued_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_baseline_collection(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_baseline_collection(uuid) TO service_role;

-- 2) Trigger: client_approved_at null -> not null dispara baseline
CREATE OR REPLACE FUNCTION public.tg_campaigns_enqueue_baseline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.client_approved_at IS NULL
     AND NEW.client_approved_at IS NOT NULL
     AND NEW.deal_id IS NOT NULL THEN
    PERFORM public.enqueue_baseline_collection(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaigns_enqueue_baseline ON public.campaigns;
CREATE TRIGGER campaigns_enqueue_baseline
AFTER UPDATE OF client_approved_at ON public.campaigns
FOR EACH ROW
EXECUTE FUNCTION public.tg_campaigns_enqueue_baseline();

-- 3) Backfill: reenfileira campanhas aprovadas hoje que ficaram travadas
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.campaigns
     WHERE client_approved_at IS NOT NULL
       AND plan_approved_at IS NULL
       AND status NOT IN ('cancelled','completed')
       AND deal_id IS NOT NULL
  LOOP
    PERFORM public.enqueue_baseline_collection(r.id);
  END LOOP;
END $$;
