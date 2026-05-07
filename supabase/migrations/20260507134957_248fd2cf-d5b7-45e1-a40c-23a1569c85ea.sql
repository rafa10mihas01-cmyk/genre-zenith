
CREATE OR REPLACE FUNCTION public.community_members_guard_protected()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_team boolean := false;
BEGIN
  BEGIN
    v_is_team := public.has_team_access();
  EXCEPTION WHEN OTHERS THEN
    v_is_team := false;
  END;

  IF v_is_team THEN
    RETURN NEW;
  END IF;

  IF NEW.points IS DISTINCT FROM OLD.points
     OR NEW.tier IS DISTINCT FROM OLD.tier
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
     OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason
     OR NEW.invite_id IS DISTINCT FROM OLD.invite_id
     OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
     OR NEW.spotify_playlist_id IS DISTINCT FROM OLD.spotify_playlist_id
     OR NEW.playlist_followers IS DISTINCT FROM OLD.playlist_followers
     OR NEW.playlist_name IS DISTINCT FROM OLD.playlist_name
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
  THEN
    RAISE EXCEPTION 'forbidden_field_update' USING HINT = 'Members cannot modify protected columns';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_community_members_guard_protected ON public.community_members;
CREATE TRIGGER trg_community_members_guard_protected
BEFORE UPDATE ON public.community_members
FOR EACH ROW EXECUTE FUNCTION public.community_members_guard_protected();
