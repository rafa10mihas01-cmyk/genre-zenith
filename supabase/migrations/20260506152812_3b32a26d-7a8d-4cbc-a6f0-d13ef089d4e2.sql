-- Tabela ledger imutável de compras
CREATE TABLE IF NOT EXISTS public.curator_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curator_id uuid NOT NULL REFERENCES public.curators(id) ON DELETE CASCADE,
  deal_id uuid,
  plays_purchased bigint NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  cpp numeric GENERATED ALWAYS AS (
    CASE WHEN plays_purchased > 0 THEN amount / plays_purchased ELSE NULL END
  ) STORED,
  note text,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curator_purchases_amount_chk CHECK (amount >= 0),
  CONSTRAINT curator_purchases_plays_chk CHECK (plays_purchased >= 0)
);

CREATE INDEX IF NOT EXISTS idx_curator_purchases_curator ON public.curator_purchases(curator_id, purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_curator_purchases_user ON public.curator_purchases(user_id, purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_curator_purchases_deal ON public.curator_purchases(deal_id) WHERE deal_id IS NOT NULL;

ALTER TABLE public.curator_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own purchases" ON public.curator_purchases
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own purchases" ON public.curator_purchases
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own purchases" ON public.curator_purchases
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
-- Sem UPDATE: ledger é append-only

-- Trigger: ao inserir compra, recalcula agregado em curators
CREATE OR REPLACE FUNCTION public.recalc_curator_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_curator_id uuid;
BEGIN
  v_curator_id := COALESCE(NEW.curator_id, OLD.curator_id);
  UPDATE public.curators c
  SET
    purchased_plays = COALESCE((SELECT SUM(plays_purchased) FROM public.curator_purchases WHERE curator_id = v_curator_id), 0),
    total_cost      = COALESCE((SELECT SUM(amount)          FROM public.curator_purchases WHERE curator_id = v_curator_id), 0),
    updated_at      = now()
  WHERE c.id = v_curator_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_curator_purchases_recalc ON public.curator_purchases;
CREATE TRIGGER trg_curator_purchases_recalc
  AFTER INSERT OR DELETE ON public.curator_purchases
  FOR EACH ROW EXECUTE FUNCTION public.recalc_curator_totals();

-- Backfill: 1 linha de baseline por curador com saldo existente
INSERT INTO public.curator_purchases (user_id, curator_id, plays_purchased, amount, note, purchased_at)
SELECT
  c.user_id,
  c.id,
  COALESCE(c.purchased_plays, 0),
  COALESCE(c.total_cost, 0),
  'backfill: saldo de abertura',
  COALESCE(c.created_at, now())
FROM public.curators c
WHERE COALESCE(c.purchased_plays, 0) > 0 OR COALESCE(c.total_cost, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.curator_purchases p WHERE p.curator_id = c.id AND p.note = 'backfill: saldo de abertura'
  );

-- Views derivadas
CREATE OR REPLACE VIEW public.v_curator_finance
WITH (security_invoker = true) AS
SELECT
  c.id AS curator_id,
  c.user_id,
  c.name,
  COALESCE(SUM(p.plays_purchased), 0)::bigint AS plays_purchased,
  COALESCE(SUM(p.amount), 0)::numeric AS total_cost,
  CASE WHEN COALESCE(SUM(p.plays_purchased), 0) > 0
    THEN SUM(p.amount) / SUM(p.plays_purchased)
    ELSE NULL END AS cpp,
  MAX(p.purchased_at) AS last_purchase_at,
  COUNT(p.id) AS purchase_count
FROM public.curators c
LEFT JOIN public.curator_purchases p ON p.curator_id = c.id
WHERE c.archived_at IS NULL
GROUP BY c.id, c.user_id, c.name;

CREATE OR REPLACE VIEW public.v_curator_global_finance
WITH (security_invoker = true) AS
SELECT
  user_id,
  COALESCE(SUM(plays_purchased), 0)::bigint AS total_plays_purchased,
  COALESCE(SUM(amount), 0)::numeric AS total_spent,
  CASE WHEN COALESCE(SUM(plays_purchased), 0) > 0
    THEN SUM(amount) / SUM(plays_purchased)
    ELSE NULL END AS global_cpp,
  COUNT(*) AS purchase_count
FROM public.curator_purchases
GROUP BY user_id;