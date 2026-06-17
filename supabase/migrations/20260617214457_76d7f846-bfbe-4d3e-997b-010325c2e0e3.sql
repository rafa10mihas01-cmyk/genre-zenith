
-- Split into BEFORE (demote) + AFTER (backfill superseded_by) to avoid FK race
CREATE OR REPLACE FUNCTION public.tg_lsu_supersede_same_day()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'imported' AND NEW.quarantined_at IS NULL THEN
    UPDATE public.label_spreadsheet_uploads
       SET status = 'superseded',
           superseded_at = NOW()
     WHERE deal_id = NEW.deal_id
       AND reference_date = NEW.reference_date
       AND id <> NEW.id
       AND status = 'imported'
       AND quarantined_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_lsu_backfill_superseded_by()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'imported' AND NEW.quarantined_at IS NULL THEN
    UPDATE public.label_spreadsheet_uploads
       SET superseded_by = NEW.id
     WHERE deal_id = NEW.deal_id
       AND reference_date = NEW.reference_date
       AND id <> NEW.id
       AND status = 'superseded'
       AND superseded_by IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lsu_backfill_superseded_by ON public.label_spreadsheet_uploads;
CREATE TRIGGER trg_lsu_backfill_superseded_by
AFTER INSERT ON public.label_spreadsheet_uploads
FOR EACH ROW EXECUTE FUNCTION public.tg_lsu_backfill_superseded_by();
