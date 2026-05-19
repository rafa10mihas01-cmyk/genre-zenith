
ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual'
  CHECK (origin IN ('campaign','manual'));

UPDATE public.curator_deals
  SET origin = 'campaign'
  WHERE campaign_id IS NOT NULL AND origin <> 'campaign';

CREATE INDEX IF NOT EXISTS idx_curator_deals_origin ON public.curator_deals(origin);
