GRANT SELECT, INSERT, UPDATE, DELETE ON public.curator_purchases TO authenticated;
GRANT ALL ON public.curator_purchases TO service_role;

DROP POLICY IF EXISTS "team_update_curator_purchases" ON public.curator_purchases;
CREATE POLICY "team_update_curator_purchases"
ON public.curator_purchases
FOR UPDATE
TO authenticated
USING (public.has_team_access())
WITH CHECK (public.has_team_access());

CREATE OR REPLACE FUNCTION public.recalc_curator_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curator_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.curator_id IS DISTINCT FROM NEW.curator_id THEN
    UPDATE public.curators c
    SET
      purchased_plays = COALESCE((SELECT SUM(plays_purchased) FROM public.curator_purchases WHERE curator_id = OLD.curator_id), 0),
      total_cost      = COALESCE((SELECT SUM(amount)          FROM public.curator_purchases WHERE curator_id = OLD.curator_id), 0),
      updated_at      = now()
    WHERE c.id = OLD.curator_id;

    UPDATE public.curators c
    SET
      purchased_plays = COALESCE((SELECT SUM(plays_purchased) FROM public.curator_purchases WHERE curator_id = NEW.curator_id), 0),
      total_cost      = COALESCE((SELECT SUM(amount)          FROM public.curator_purchases WHERE curator_id = NEW.curator_id), 0),
      updated_at      = now()
    WHERE c.id = NEW.curator_id;

    RETURN NEW;
  END IF;

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
AFTER INSERT OR UPDATE OR DELETE ON public.curator_purchases
FOR EACH ROW EXECUTE FUNCTION public.recalc_curator_totals();