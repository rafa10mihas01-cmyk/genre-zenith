
CREATE OR REPLACE FUNCTION public.autofill_baseline_reference_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Só age quando reference_date ainda é NULL e captured_at acabou de ser definido.
  IF NEW.baseline_reference_date IS NULL
     AND NEW.baseline_captured_at IS NOT NULL THEN
    NEW.baseline_reference_date :=
      (NEW.baseline_captured_at AT TIME ZONE 'UTC')::date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS autofill_baseline_reference_date_campaigns ON public.campaigns;
CREATE TRIGGER autofill_baseline_reference_date_campaigns
  BEFORE INSERT OR UPDATE OF baseline_captured_at, baseline_reference_date ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.autofill_baseline_reference_date();

DROP TRIGGER IF EXISTS autofill_baseline_reference_date_curator_deals ON public.curator_deals;
CREATE TRIGGER autofill_baseline_reference_date_curator_deals
  BEFORE INSERT OR UPDATE OF baseline_captured_at, baseline_reference_date ON public.curator_deals
  FOR EACH ROW EXECUTE FUNCTION public.autofill_baseline_reference_date();
