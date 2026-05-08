-- Modelo de cobrança no deal
ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS billing_model text NOT NULL DEFAULT 'per_streams',
  ADD COLUMN IF NOT EXISTS monthly_amount numeric,
  ADD COLUMN IF NOT EXISTS cycle_months integer,
  ADD COLUMN IF NOT EXISTS next_invoice_at timestamptz;

-- Validação: só aceita os dois modelos conhecidos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'curator_deals_billing_model_check'
  ) THEN
    ALTER TABLE public.curator_deals
      ADD CONSTRAINT curator_deals_billing_model_check
      CHECK (billing_model IN ('per_streams','monthly_retainer'));
  END IF;
END $$;

-- Índice pra varrer mensalistas pendentes de cobrança
CREATE INDEX IF NOT EXISTS idx_curator_deals_monthly_next_invoice
  ON public.curator_deals (next_invoice_at)
  WHERE billing_model = 'monthly_retainer' AND closed_at IS NULL;