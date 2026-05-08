ALTER TABLE public.curators
  ADD COLUMN IF NOT EXISTS deal_type text NOT NULL DEFAULT 'avulso',
  ADD COLUMN IF NOT EXISTS default_amount numeric,
  ADD COLUMN IF NOT EXISTS default_plays bigint,
  ADD COLUMN IF NOT EXISTS monthly_amount numeric,
  ADD COLUMN IF NOT EXISTS billing_day smallint;

ALTER TABLE public.curators
  DROP CONSTRAINT IF EXISTS curators_deal_type_check;
ALTER TABLE public.curators
  ADD CONSTRAINT curators_deal_type_check CHECK (deal_type IN ('avulso','mensal'));
ALTER TABLE public.curators
  DROP CONSTRAINT IF EXISTS curators_billing_day_check;
ALTER TABLE public.curators
  ADD CONSTRAINT curators_billing_day_check CHECK (billing_day IS NULL OR (billing_day BETWEEN 1 AND 31));