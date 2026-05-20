
CREATE OR REPLACE FUNCTION public.reject_snapshot_regression()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.plays_7d IS NOT NULL AND NEW.plays_28d IS NOT NULL AND NEW.plays_7d > NEW.plays_28d THEN
    RAISE EXCEPTION 'snapshot_regression: plays_7d (%) > plays_28d (%) — matematicamente impossível', NEW.plays_7d, NEW.plays_28d
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.plays_24h IS NOT NULL AND NEW.plays_7d IS NOT NULL AND NEW.plays_24h > NEW.plays_7d THEN
    RAISE EXCEPTION 'snapshot_regression: plays_24h (%) > plays_7d (%) — matematicamente impossível', NEW.plays_24h, NEW.plays_7d
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_snapshot_regression ON public.curator_deal_snapshots;
CREATE TRIGGER reject_snapshot_regression
BEFORE INSERT OR UPDATE ON public.curator_deal_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.reject_snapshot_regression();
