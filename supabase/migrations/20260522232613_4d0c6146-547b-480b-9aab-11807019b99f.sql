
CREATE OR REPLACE FUNCTION public.prevent_community_participation_self_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_team boolean;
BEGIN
  -- Team (admin/curador) bypass — full control
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'curador')
  ) INTO is_team;

  IF is_team THEN
    RETURN NEW;
  END IF;

  -- Non-team users: block changes to review/points fields
  IF NEW.points_awarded   IS DISTINCT FROM OLD.points_awarded
  OR NEW.points_offered   IS DISTINCT FROM OLD.points_offered
  OR NEW.reviewed_by      IS DISTINCT FROM OLD.reviewed_by
  OR NEW.reviewed_at      IS DISTINCT FROM OLD.reviewed_at
  OR NEW.review_note      IS DISTINCT FROM OLD.review_note THEN
    RAISE EXCEPTION 'forbidden: cannot modify review fields'
      USING ERRCODE = '42501';
  END IF;

  -- Members may only transition status accepted -> submitted
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (OLD.status = 'accepted' AND NEW.status = 'submitted') THEN
      RAISE EXCEPTION 'forbidden: invalid status transition'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_community_participation_self_escalation
  ON public.community_participations;

CREATE TRIGGER trg_prevent_community_participation_self_escalation
BEFORE UPDATE ON public.community_participations
FOR EACH ROW
EXECUTE FUNCTION public.prevent_community_participation_self_escalation();
