ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS collection_mode text NOT NULL DEFAULT 'bot';

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_collection_mode_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_collection_mode_check
  CHECK (collection_mode IN ('bot','spreadsheet'));

UPDATE public.campaigns c
SET collection_mode = d.collection_mode
FROM public.curator_deals d
WHERE c.deal_id = d.id
  AND d.collection_mode IS NOT NULL
  AND c.collection_mode <> d.collection_mode;