ALTER TABLE public.campaign_external_package_items
  ADD COLUMN IF NOT EXISTS source_purchase_id uuid
    REFERENCES public.curator_purchases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cepi_source_purchase
  ON public.campaign_external_package_items(source_purchase_id)
  WHERE source_purchase_id IS NOT NULL;