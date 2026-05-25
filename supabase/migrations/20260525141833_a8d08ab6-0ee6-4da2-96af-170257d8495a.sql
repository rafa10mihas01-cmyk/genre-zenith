ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS collection_mode text NOT NULL DEFAULT 'bot';

ALTER TABLE public.curator_deals
  DROP CONSTRAINT IF EXISTS curator_deals_collection_mode_check;

ALTER TABLE public.curator_deals
  ADD CONSTRAINT curator_deals_collection_mode_check
  CHECK (collection_mode IN ('bot','spreadsheet'));

UPDATE public.curator_deals
SET collection_mode = CASE
  WHEN spotify_owner_id IS NOT NULL THEN 'bot'
  ELSE 'spreadsheet'
END;

CREATE INDEX IF NOT EXISTS idx_curator_deals_collection_mode
  ON public.curator_deals(collection_mode);