-- 1) Backfill: deals vinculados a campanha sempre são origin=campaign
UPDATE public.curator_deals
SET origin = 'campaign'
WHERE campaign_id IS NOT NULL
  AND (origin IS NULL OR origin = 'manual');

-- 2) Trigger garante invariante: campaign_id => origin=campaign
CREATE OR REPLACE FUNCTION public.enforce_curator_deal_origin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL THEN
    NEW.origin := 'campaign';
  ELSIF NEW.origin IS NULL THEN
    NEW.origin := 'manual';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_curator_deal_origin ON public.curator_deals;
CREATE TRIGGER trg_enforce_curator_deal_origin
BEFORE INSERT OR UPDATE OF campaign_id, origin ON public.curator_deals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_curator_deal_origin();