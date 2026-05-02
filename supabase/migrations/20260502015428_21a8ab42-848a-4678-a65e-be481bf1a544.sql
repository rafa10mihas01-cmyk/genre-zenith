-- Função de timestamp (idempotente)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.curator_fraud_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID NOT NULL,
  playlist_id UUID,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  acknowledged_by UUID,
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_curator_fraud_alerts_deal_id ON public.curator_fraud_alerts(deal_id);
CREATE INDEX idx_curator_fraud_alerts_status ON public.curator_fraud_alerts(status);

ALTER TABLE public.curator_fraud_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own fraud_alerts"
ON public.curator_fraud_alerts FOR SELECT TO authenticated
USING (deal_id IN (SELECT id FROM curator_deals WHERE user_id = auth.uid()));

CREATE POLICY "Users insert own fraud_alerts"
ON public.curator_fraud_alerts FOR INSERT TO authenticated
WITH CHECK (deal_id IN (SELECT id FROM curator_deals WHERE user_id = auth.uid()));

CREATE POLICY "Users update own fraud_alerts"
ON public.curator_fraud_alerts FOR UPDATE TO authenticated
USING (deal_id IN (SELECT id FROM curator_deals WHERE user_id = auth.uid()))
WITH CHECK (deal_id IN (SELECT id FROM curator_deals WHERE user_id = auth.uid()));

CREATE POLICY "Users delete own fraud_alerts"
ON public.curator_fraud_alerts FOR DELETE TO authenticated
USING (deal_id IN (SELECT id FROM curator_deals WHERE user_id = auth.uid()));

CREATE TRIGGER trg_curator_fraud_alerts_updated
BEFORE UPDATE ON public.curator_fraud_alerts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS reconciled_total_plays BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reconciled_streams_7d BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reconciled_streams_28d BIGINT NOT NULL DEFAULT 0;