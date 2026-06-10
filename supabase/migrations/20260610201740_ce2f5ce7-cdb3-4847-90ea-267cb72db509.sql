
-- 1) Coluna de ligação 1:1 entre item de pacote externo e curator_deal.
ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS external_package_item_id uuid
    REFERENCES public.campaign_external_package_items(id) ON DELETE SET NULL;

-- 2) UNIQUE: impede 2 deals para o mesmo item de pacote.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_curator_deals_external_package_item
  ON public.curator_deals(external_package_item_id)
  WHERE external_package_item_id IS NOT NULL;

-- 3) UNIQUE: impede 2 itens do mesmo curador no mesmo pacote.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cep_items_package_curator
  ON public.campaign_external_package_items(package_id, curator_id);

-- 4) Backfill do caso atual: limpa duplicata e corrige target_plays.
DELETE FROM public.curator_deals
  WHERE id = 'c7e7e363-36e5-4816-bb19-d2ed4203140b';

UPDATE public.curator_deals
  SET target_plays = 900000,
      daily_goal = CEIL(900000::numeric / NULLIF(GREATEST(EXTRACT(EPOCH FROM (ends_at - created_at))/86400, 1), 0)),
      external_package_item_id = '779f7588-c32c-4422-8e9d-07960f6968c2'
  WHERE id = '17078ab1-db28-427a-b648-059be6b7a2da';

-- 5) Backfill geral: liga curator_deals já existentes vindos de pacote externo
-- ao item correspondente (via curator_deal_id em campaign_external_package_items).
UPDATE public.curator_deals d
   SET external_package_item_id = i.id
  FROM public.campaign_external_package_items i
 WHERE i.curator_deal_id = d.id
   AND d.external_package_item_id IS NULL;
