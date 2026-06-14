
ALTER TABLE public.catalog_placements
  DROP CONSTRAINT IF EXISTS catalog_placements_status_check;

ALTER TABLE public.catalog_placements
  ADD CONSTRAINT catalog_placements_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'retry'::text, 'active'::text, 'removed'::text, 'failed'::text]));
