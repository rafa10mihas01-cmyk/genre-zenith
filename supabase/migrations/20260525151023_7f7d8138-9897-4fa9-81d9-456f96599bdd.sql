-- Sync curator_deals.collection_mode com campaigns.collection_mode (fonte de verdade)
UPDATE public.curator_deals cd
SET collection_mode = c.collection_mode
FROM public.campaigns c
WHERE cd.campaign_id = c.id
  AND c.collection_mode IS NOT NULL
  AND cd.collection_mode IS DISTINCT FROM c.collection_mode;

-- Trigger: quando campaigns.collection_mode muda, propaga pro deal vinculado
CREATE OR REPLACE FUNCTION public.tg_sync_campaign_collection_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.collection_mode IS DISTINCT FROM OLD.collection_mode AND NEW.collection_mode IS NOT NULL THEN
    UPDATE public.curator_deals
    SET collection_mode = NEW.collection_mode
    WHERE campaign_id = NEW.id;

    -- Ajusta auto_collect em curator_deal_songs pra parar/retomar o bot
    UPDATE public.curator_deal_songs
    SET auto_collect = (NEW.collection_mode <> 'spreadsheet')
    WHERE deal_id IN (SELECT id FROM public.curator_deals WHERE campaign_id = NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_campaign_collection_mode ON public.campaigns;
CREATE TRIGGER trg_sync_campaign_collection_mode
AFTER UPDATE OF collection_mode ON public.campaigns
FOR EACH ROW
EXECUTE FUNCTION public.tg_sync_campaign_collection_mode();