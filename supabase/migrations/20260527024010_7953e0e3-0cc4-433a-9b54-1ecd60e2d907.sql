
-- 1) Redefine v_financial_summary usando curator_purchases como fonte de custo
DROP VIEW IF EXISTS public.v_financial_summary;

CREATE VIEW public.v_financial_summary AS
SELECT
  c.id AS campaign_id,
  c.track_name,
  c.artist,
  c.status AS campaign_status,
  c.valor_cobrado,
  c.valor_recebido,
  COALESCE(c.valor_cobrado, 0::numeric) - COALESCE(c.valor_recebido, 0::numeric) AS receita_pendente,
  COALESCE(custo.total, 0::numeric) AS total_pago_curadores,
  COALESCE(c.valor_recebido, 0::numeric) - COALESCE(custo.total, 0::numeric) AS margem_bruta,
  round(
    (COALESCE(c.valor_recebido, 0::numeric) - COALESCE(custo.total, 0::numeric))
    / NULLIF(c.valor_recebido, 0::numeric) * 100::numeric,
    1
  ) AS margem_pct,
  COALESCE(deals.num_deals, 0) AS num_deals,
  c.created_at
FROM public.campaigns c
LEFT JOIN LATERAL (
  SELECT COUNT(DISTINCT cd.id) AS num_deals
  FROM public.curator_deals cd
  WHERE cd.campaign_id = c.id OR cd.id = c.deal_id
) deals ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(cp.amount), 0)::numeric AS total
  FROM public.curator_purchases cp
  JOIN public.curator_deals cd ON cd.id = cp.deal_id
  WHERE cd.campaign_id = c.id OR cd.id = c.deal_id
) custo ON true;

GRANT SELECT ON public.v_financial_summary TO authenticated;
GRANT SELECT ON public.v_financial_summary TO service_role;

-- 2) Nova view: custo não alocado (compras sem deal vinculado OU deal inexistente)
CREATE OR REPLACE VIEW public.v_financial_unallocated_cost AS
SELECT
  COALESCE(SUM(cp.amount), 0)::numeric AS total_nao_alocado,
  COUNT(*)::int AS num_compras
FROM public.curator_purchases cp
LEFT JOIN public.curator_deals cd ON cd.id = cp.deal_id
WHERE cp.deal_id IS NULL OR cd.id IS NULL;

GRANT SELECT ON public.v_financial_unallocated_cost TO authenticated;
GRANT SELECT ON public.v_financial_unallocated_cost TO service_role;

-- 3) Comentário deprecando curator_deal_payments
COMMENT ON TABLE public.curator_deal_payments IS
  'DEPRECATED desde 2026-05: fonte única de custo é curator_purchases. Mantida apenas para histórico — não usar em novos cálculos.';
