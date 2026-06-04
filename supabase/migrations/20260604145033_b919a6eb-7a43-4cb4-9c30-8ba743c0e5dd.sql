DROP FUNCTION IF EXISTS public.enqueue_baseline_collection(uuid);

CREATE OR REPLACE FUNCTION public.enqueue_baseline_collection(p_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
BEGIN
  SELECT deal_id INTO v_deal_id FROM campaigns WHERE id = p_campaign_id;
  IF v_deal_id IS NULL THEN RETURN; END IF;

  UPDATE curator_deal_songs
     SET auto_collect = true,
         auto_collect_status = 'idle',
         auto_collect_error = NULL,
         next_auto_collect_at = now(),
         queued_at = now()
   WHERE deal_id = v_deal_id;

  UPDATE campaigns
     SET baseline_status = 'pending'
   WHERE id = p_campaign_id
     AND (baseline_status IS NULL OR baseline_status NOT IN ('pending','captured'));
END;
$$;

-- Recria trigger pra apontar para a função recriada
DROP TRIGGER IF EXISTS tg_campaigns_enqueue_baseline ON public.campaigns;

CREATE OR REPLACE FUNCTION public.tg_campaigns_enqueue_baseline_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.client_approved_at IS NOT NULL
     AND (OLD.client_approved_at IS NULL OR OLD.client_approved_at IS DISTINCT FROM NEW.client_approved_at)
     AND NEW.deal_id IS NOT NULL THEN
    PERFORM public.enqueue_baseline_collection(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_campaigns_enqueue_baseline
AFTER UPDATE OF client_approved_at ON public.campaigns
FOR EACH ROW EXECUTE FUNCTION public.tg_campaigns_enqueue_baseline_fn();

-- Destrava as 4 baselines presas hoje
UPDATE curator_deal_songs
   SET auto_collect_status = 'idle',
       auto_collect_error = NULL,
       next_auto_collect_at = now()
 WHERE auto_collect_status = 'pending'
   AND auto_collect = true
   AND deal_id IN (
     SELECT deal_id FROM campaigns
      WHERE client_approved_at >= now() - interval '24 hours'
        AND baseline_status = 'pending'
        AND deal_id IS NOT NULL
   );