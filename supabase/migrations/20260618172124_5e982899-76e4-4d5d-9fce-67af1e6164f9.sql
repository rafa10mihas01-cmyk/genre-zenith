-- 8.1 Consolidação Financeiro

-- 1) Limpa deal_id apontando para deal inexistente (vira NULL = "não alocado")
UPDATE public.curator_purchases
SET deal_id = NULL
WHERE deal_id IS NOT NULL
  AND deal_id NOT IN (SELECT id FROM public.curator_deals);

-- 2) Cria FK oficial curator_purchases.deal_id -> curator_deals.id
ALTER TABLE public.curator_purchases
  ADD CONSTRAINT curator_purchases_deal_id_fkey
  FOREIGN KEY (deal_id) REFERENCES public.curator_deals(id) ON DELETE SET NULL;

-- 3) Remove tabela deprecada curator_deal_payments (0 linhas)
DROP TABLE IF EXISTS public.curator_deal_payments CASCADE;

-- 4) Remove RPCs nunca utilizadas pelo frontend (decisão: modelo PIX simples na tabela curators)
DROP FUNCTION IF EXISTS public.admin_get_curator_payment(uuid);
DROP FUNCTION IF EXISTS public.admin_set_curator_payment(uuid, text, text, text);

-- 5) Audit trail em curator_purchases (mesmo padrão de pricing_settings)
DROP TRIGGER IF EXISTS trg_audit_curator_purchases ON public.curator_purchases;
CREATE TRIGGER trg_audit_curator_purchases
  AFTER INSERT OR UPDATE OR DELETE ON public.curator_purchases
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();