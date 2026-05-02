-- Fase 4: fechamento de deals
ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_reason TEXT,
  ADD COLUMN IF NOT EXISTS closed_status TEXT,
  ADD COLUMN IF NOT EXISTS final_report_url TEXT;

-- closed_status: 'completed' (bateu meta) | 'cancelled' (encerrado manual sem bater) | NULL (ativo)
ALTER TABLE public.curator_deals
  DROP CONSTRAINT IF EXISTS curator_deals_closed_status_check;
ALTER TABLE public.curator_deals
  ADD CONSTRAINT curator_deals_closed_status_check
  CHECK (closed_status IS NULL OR closed_status IN ('completed','cancelled'));

CREATE INDEX IF NOT EXISTS idx_curator_deals_closed_at
  ON public.curator_deals(closed_at);
CREATE INDEX IF NOT EXISTS idx_curator_deals_user_active
  ON public.curator_deals(user_id) WHERE closed_at IS NULL;