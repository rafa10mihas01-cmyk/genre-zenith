
-- 1) Colunas novas
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS baseline_reference_date DATE NULL;

ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS baseline_reference_date DATE NULL;

COMMENT ON COLUMN public.campaigns.baseline_reference_date IS
  'Data oficial da baseline (reference_date do primeiro upload baseline). Imutável após definida. Diferente de baseline_captured_at, que é a data/hora em que o operador rodou a importação.';
COMMENT ON COLUMN public.curator_deals.baseline_reference_date IS
  'Espelho de campaigns.baseline_reference_date para o deal. Imutável após definida.';

-- 2) Trigger de imutabilidade
CREATE OR REPLACE FUNCTION public.lock_baseline_reference_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.baseline_reference_date IS NOT NULL
     AND NEW.baseline_reference_date IS DISTINCT FROM OLD.baseline_reference_date THEN
    RAISE EXCEPTION
      'baseline_reference_date é imutável (id=%, atual=%, tentativa=%)',
      OLD.id, OLD.baseline_reference_date, NEW.baseline_reference_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_baseline_reference_date_campaigns ON public.campaigns;
CREATE TRIGGER lock_baseline_reference_date_campaigns
  BEFORE UPDATE OF baseline_reference_date ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.lock_baseline_reference_date();

DROP TRIGGER IF EXISTS lock_baseline_reference_date_curator_deals ON public.curator_deals;
CREATE TRIGGER lock_baseline_reference_date_curator_deals
  BEFORE UPDATE OF baseline_reference_date ON public.curator_deals
  FOR EACH ROW EXECUTE FUNCTION public.lock_baseline_reference_date();

-- 3) Backfill em campaigns (prioridade: upload baseline mais antigo → upload mais antigo → captured_at)
WITH baseline_upload AS (
  SELECT u.deal_id,
         MIN(u.reference_date) FILTER (WHERE u.is_baseline = true) AS ref_baseline,
         MIN(u.reference_date)                                     AS ref_oldest
  FROM public.label_spreadsheet_uploads u
  WHERE u.reference_date IS NOT NULL
    AND (u.quarantined_at IS NULL)
  GROUP BY u.deal_id
)
UPDATE public.campaigns c
   SET baseline_reference_date = COALESCE(
         bu.ref_baseline,
         bu.ref_oldest,
         (c.baseline_captured_at AT TIME ZONE 'UTC')::date
       )
  FROM baseline_upload bu
 WHERE c.deal_id = bu.deal_id
   AND c.baseline_reference_date IS NULL
   AND (bu.ref_baseline IS NOT NULL OR bu.ref_oldest IS NOT NULL OR c.baseline_captured_at IS NOT NULL);

-- Campanhas sem upload mas com baseline_captured_at: usa só o fallback
UPDATE public.campaigns c
   SET baseline_reference_date = (c.baseline_captured_at AT TIME ZONE 'UTC')::date
 WHERE c.baseline_reference_date IS NULL
   AND c.baseline_captured_at IS NOT NULL;

-- 4) Backfill em curator_deals (espelho da campanha)
UPDATE public.curator_deals d
   SET baseline_reference_date = c.baseline_reference_date
  FROM public.campaigns c
 WHERE d.campaign_id = c.id
   AND d.baseline_reference_date IS NULL
   AND c.baseline_reference_date IS NOT NULL;

-- Deal interno (placeholder) — referenciado por campaigns.deal_id
UPDATE public.curator_deals d
   SET baseline_reference_date = c.baseline_reference_date
  FROM public.campaigns c
 WHERE c.deal_id = d.id
   AND d.baseline_reference_date IS NULL
   AND c.baseline_reference_date IS NOT NULL;
