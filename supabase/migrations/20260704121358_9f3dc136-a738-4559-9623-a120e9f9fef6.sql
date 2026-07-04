
-- ===== 1) DATA FIX RETROATIVO =====
-- Restaura o deal real do Plug Music (campanha "Passa O Teu Bigode 2")
UPDATE public.curator_deals
   SET source = NULL
 WHERE source = 'campaign_internal'
   AND curator_id IS NOT NULL;

-- Repointa campaigns.deal_id para o stub correto (curator_id IS NULL) sempre
-- que estiver apontando para um deal com curador da mesma campanha.
UPDATE public.campaigns c
   SET deal_id = stub.id
  FROM public.curator_deals bad
  JOIN LATERAL (
        SELECT id FROM public.curator_deals s
         WHERE s.campaign_id = bad.campaign_id
           AND s.curator_id IS NULL
         ORDER BY created_at ASC
         LIMIT 1
       ) stub ON TRUE
 WHERE c.deal_id = bad.id
   AND bad.curator_id IS NOT NULL
   AND bad.campaign_id = c.id;

-- ===== 2) GUARDRAIL: source='campaign_internal' só pode existir em stub =====
CREATE OR REPLACE FUNCTION public.enforce_campaign_internal_is_stub()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.source = 'campaign_internal' AND NEW.curator_id IS NOT NULL THEN
    RAISE EXCEPTION
      'curator_deals.source=campaign_internal só é válido em deals stub (curator_id IS NULL). deal_id=%, curator_id=%',
      NEW.id, NEW.curator_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_campaign_internal_is_stub ON public.curator_deals;
CREATE TRIGGER trg_enforce_campaign_internal_is_stub
BEFORE INSERT OR UPDATE OF source, curator_id
ON public.curator_deals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_campaign_internal_is_stub();

-- ===== 3) GUARDRAIL: campaigns.deal_id só pode apontar pra stub da campanha =====
CREATE OR REPLACE FUNCTION public.enforce_campaign_deal_id_is_stub()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_curator_id UUID;
  v_source TEXT;
  v_campaign_id UUID;
BEGIN
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Só valida em UPDATE quando o valor de fato muda; INSERT sempre valida.
  IF TG_OP = 'UPDATE' AND NEW.deal_id IS NOT DISTINCT FROM OLD.deal_id THEN
    RETURN NEW;
  END IF;

  SELECT curator_id, source, campaign_id
    INTO v_curator_id, v_source, v_campaign_id
    FROM public.curator_deals
   WHERE id = NEW.deal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaigns.deal_id=% não existe em curator_deals', NEW.deal_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_curator_id IS NOT NULL THEN
    RAISE EXCEPTION
      'campaigns.deal_id deve apontar para um deal stub da própria campanha (curator_id IS NULL). deal=%, curator=%',
      NEW.deal_id, v_curator_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_campaign_id IS NOT NULL AND v_campaign_id <> NEW.id THEN
    RAISE EXCEPTION
      'campaigns.deal_id=% pertence à campanha % e não pode ser vinculado à campanha %',
      NEW.deal_id, v_campaign_id, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_campaign_deal_id_is_stub ON public.campaigns;
CREATE TRIGGER trg_enforce_campaign_deal_id_is_stub
BEFORE INSERT OR UPDATE OF deal_id
ON public.campaigns
FOR EACH ROW
EXECUTE FUNCTION public.enforce_campaign_deal_id_is_stub();
