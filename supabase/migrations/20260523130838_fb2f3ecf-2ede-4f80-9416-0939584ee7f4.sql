
-- Fix 1: community_members - replace broken self-referential policy with a trigger-enforced lock
DROP POLICY IF EXISTS member_update_own_safe_fields ON public.community_members;

CREATE OR REPLACE FUNCTION public.community_members_lock_sensitive_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Team members (staff) can update any field freely
  IF public.has_team_access() THEN
    RETURN NEW;
  END IF;

  -- Self-update path: force sensitive fields back to OLD values
  IF auth.uid() IS NOT NULL AND OLD.user_id = auth.uid() THEN
    NEW.user_id          := OLD.user_id;
    NEW.points           := OLD.points;
    NEW.tier             := OLD.tier;
    NEW.status           := OLD.status;
    NEW.suspended_at     := OLD.suspended_at;
    NEW.suspended_reason := OLD.suspended_reason;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not authorized to update community_members row';
END;
$$;

DROP TRIGGER IF EXISTS trg_community_members_lock_sensitive ON public.community_members;
CREATE TRIGGER trg_community_members_lock_sensitive
BEFORE UPDATE ON public.community_members
FOR EACH ROW
EXECUTE FUNCTION public.community_members_lock_sensitive_fields();

CREATE POLICY member_update_own_safe_fields
ON public.community_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Fix 2: curator_deal_delivery_status - add team access SELECT (additive, owner access preserved & intentional)
CREATE POLICY team_select_curator_deal_delivery_status
ON public.curator_deal_delivery_status
FOR SELECT
TO authenticated
USING (public.has_team_access());

-- Fix 3: curator_deal_plan - add team access SELECT
CREATE POLICY team_select_curator_deal_plan
ON public.curator_deal_plan
FOR SELECT
TO authenticated
USING (public.has_team_access());

-- Fix 4: spotify_apps - remove duplicate overlapping admin SELECT policy
DROP POLICY IF EXISTS "spotify_apps admin select" ON public.spotify_apps;
