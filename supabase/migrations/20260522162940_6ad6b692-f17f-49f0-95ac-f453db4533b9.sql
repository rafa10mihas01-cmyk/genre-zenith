
-- ============ PART 1: Ledger de pagamentos a curadores ============
CREATE TABLE IF NOT EXISTS public.curator_deal_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       uuid NOT NULL REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  amount        numeric(12,2) NOT NULL CHECK (amount >= 0),
  payment_date  date NOT NULL DEFAULT CURRENT_DATE,
  method        text,
  notes         text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_curator_deal_payments_deal_id
  ON public.curator_deal_payments(deal_id);
CREATE INDEX IF NOT EXISTS idx_curator_deal_payments_payment_date
  ON public.curator_deal_payments(payment_date DESC);

ALTER TABLE public.curator_deal_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team_all_payments" ON public.curator_deal_payments;
CREATE POLICY "team_all_payments"
  ON public.curator_deal_payments
  FOR ALL
  TO authenticated
  USING (public.has_team_access())
  WITH CHECK (public.has_team_access());

-- ============ Receita da campanha (cliente) ============
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS valor_cobrado     numeric(12,2),
  ADD COLUMN IF NOT EXISTS valor_recebido    numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recebido_em       date,
  ADD COLUMN IF NOT EXISTS forma_recebimento text;

-- ============ Visão consolidada custo vs receita ============
CREATE OR REPLACE VIEW public.v_financial_summary AS
SELECT
  c.id                                                                AS campaign_id,
  c.track_name,
  c.artist,
  c.status                                                            AS campaign_status,
  c.valor_cobrado,
  c.valor_recebido,
  COALESCE(c.valor_cobrado, 0) - COALESCE(c.valor_recebido, 0)        AS receita_pendente,
  COALESCE(SUM(cdp.amount), 0)                                        AS total_pago_curadores,
  COALESCE(c.valor_recebido, 0) - COALESCE(SUM(cdp.amount), 0)        AS margem_bruta,
  ROUND(
    (COALESCE(c.valor_recebido, 0) - COALESCE(SUM(cdp.amount), 0))
    / NULLIF(c.valor_recebido, 0) * 100, 1
  )                                                                   AS margem_pct,
  COUNT(DISTINCT cd.id)                                               AS num_deals,
  c.created_at
FROM public.campaigns c
LEFT JOIN public.curator_deals cd
  ON cd.campaign_id = c.id OR cd.id = c.deal_id
LEFT JOIN public.curator_deal_payments cdp
  ON cdp.deal_id = cd.id
GROUP BY c.id;

-- ============ PART 4 FIX C: Notificação de baseline ausente ============
-- Função utilitária invocável pelo backend; cria notificação 1x por deal
-- (chave de dedupe via metadata->>'deal_id' + type).
CREATE OR REPLACE FUNCTION public.notify_baseline_missing(p_deal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE type = 'baseline_missing'
      AND metadata->>'deal_id' = p_deal_id::text
      AND created_at > now() - interval '7 days'
  ) INTO v_exists;

  IF v_exists THEN RETURN; END IF;

  INSERT INTO public.notifications (type, title, message, metadata)
  VALUES (
    'baseline_missing',
    'Baseline não capturado',
    'Deal ' || p_deal_id::text || ': baseline ausente — plays pré-existentes podem estar contando como entregues.',
    jsonb_build_object('deal_id', p_deal_id)
  );
END;
$$;
