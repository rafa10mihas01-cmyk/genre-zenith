-- Fonte única de verdade do entregue da campanha:
--   curator_deals.reconciled_total_plays (somado por campaign_id) → campaigns.total_delivered
-- Mantém campaigns.total_delivered como cache materializado pra leitura barata
-- no portal cliente e nas telas internas — sem mudar nenhum consumidor.

CREATE OR REPLACE FUNCTION public.sync_campaign_total_delivered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_ids uuid[] := ARRAY[]::uuid[];
  v_cid uuid;
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.campaign_id IS NOT NULL THEN
    v_campaign_ids := array_append(v_campaign_ids, NEW.campaign_id);
  END IF;
  IF (TG_OP = 'UPDATE' OR TG_OP = 'DELETE') AND OLD.campaign_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.campaign_id IS DISTINCT FROM NEW.campaign_id) THEN
    v_campaign_ids := array_append(v_campaign_ids, OLD.campaign_id);
  END IF;

  FOREACH v_cid IN ARRAY v_campaign_ids LOOP
    UPDATE public.campaigns c
       SET total_delivered = COALESCE((
             SELECT SUM(cd.reconciled_total_plays)::bigint
               FROM public.curator_deals cd
              WHERE cd.campaign_id = v_cid
           ), 0)
     WHERE c.id = v_cid;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_campaign_total_delivered ON public.curator_deals;
CREATE TRIGGER trg_sync_campaign_total_delivered
AFTER INSERT OR UPDATE OF reconciled_total_plays, campaign_id OR DELETE
ON public.curator_deals
FOR EACH ROW
EXECUTE FUNCTION public.sync_campaign_total_delivered();

-- Backfill: zera o lag de qualquer campanha vinculada a deals já reconciliados.
UPDATE public.campaigns c
   SET total_delivered = COALESCE(sub.sum_plays, 0)
  FROM (
    SELECT campaign_id, SUM(reconciled_total_plays)::bigint AS sum_plays
      FROM public.curator_deals
     WHERE campaign_id IS NOT NULL
     GROUP BY campaign_id
  ) sub
 WHERE c.id = sub.campaign_id
   AND c.total_delivered IS DISTINCT FROM COALESCE(sub.sum_plays, 0);