
CREATE OR REPLACE FUNCTION public.community_members_block_self_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow service_role and team members to change anything
  IF auth.role() = 'service_role' OR public.has_team_access() THEN
    RETURN NEW;
  END IF;

  -- Otherwise, protected columns must not change
  IF NEW.points IS DISTINCT FROM OLD.points
     OR NEW.tier IS DISTINCT FROM OLD.tier
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
     OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
  THEN
    RAISE EXCEPTION 'Cannot modify protected fields on community_members';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_community_members_block_self_escalation ON public.community_members;
CREATE TRIGGER trg_community_members_block_self_escalation
  BEFORE UPDATE ON public.community_members
  FOR EACH ROW
  EXECUTE FUNCTION public.community_members_block_self_escalation();
