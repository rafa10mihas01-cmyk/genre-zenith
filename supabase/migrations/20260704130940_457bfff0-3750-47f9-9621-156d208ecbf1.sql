
-- 1. Fix Security Definer View: set security_invoker
ALTER VIEW public.v_playlist_track_origin SET (security_invoker = on);

-- 2. Restrict curator UPDATE on curator_campaign_playlists to safe columns only.
-- Curators can only touch playlist_url; sensitive/KPI fields must stay staff-only.
DROP POLICY IF EXISTS "curator updates own ccp" ON public.curator_campaign_playlists;

CREATE OR REPLACE FUNCTION public.ccp_curator_only_safe_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  is_curator_owner boolean;
BEGIN
  -- If caller has team access, allow anything
  IF public.has_team_access() THEN
    RETURN NEW;
  END IF;

  -- If caller is the curator owner, only allow safe field changes
  SELECT EXISTS (
    SELECT 1 FROM public.curators c
    WHERE c.id = NEW.curator_id AND c.user_id = auth.uid()
  ) INTO is_curator_owner;

  IF NOT is_curator_owner THEN
    RAISE EXCEPTION 'not allowed to update this ccp row';
  END IF;

  -- Block changes to protected fields
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.curator_id IS DISTINCT FROM OLD.curator_id
     OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
     OR NEW.playlist_id IS DISTINCT FROM OLD.playlist_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.matched_at IS DISTINCT FROM OLD.matched_at
     OR NEW.first_seen_collection_run_id IS DISTINCT FROM OLD.first_seen_collection_run_id
     OR NEW.baseline_conflict_at IS DISTINCT FROM OLD.baseline_conflict_at
     OR NEW.baseline_conflict_source IS DISTINCT FROM OLD.baseline_conflict_source
     OR NEW.excluded_from_kpis IS DISTINCT FROM OLD.excluded_from_kpis
     OR NEW.registered_at IS DISTINCT FROM OLD.registered_at
  THEN
    RAISE EXCEPTION 'curators may only edit playlist_url on curator_campaign_playlists';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ccp_curator_only_safe_columns ON public.curator_campaign_playlists;
CREATE TRIGGER trg_ccp_curator_only_safe_columns
BEFORE UPDATE ON public.curator_campaign_playlists
FOR EACH ROW EXECUTE FUNCTION public.ccp_curator_only_safe_columns();

CREATE POLICY "curator updates own ccp"
ON public.curator_campaign_playlists
FOR UPDATE
TO authenticated
USING (
  curator_id IN (SELECT id FROM public.curators WHERE user_id = auth.uid())
)
WITH CHECK (
  curator_id IN (SELECT id FROM public.curators WHERE user_id = auth.uid())
);

-- 3. Notifications: allow users to delete their own notifications
CREATE POLICY "users_delete_own_notifications"
ON public.notifications
FOR DELETE
TO authenticated
USING (user_id IS NOT NULL AND user_id = auth.uid());

-- 4. user_roles: explicit admin-only INSERT and UPDATE policies (defense-in-depth).
-- Currently there are no INSERT/UPDATE policies, so RLS denies them, but making
-- the guarantee explicit prevents future permissive additions from escalating privileges.
DROP POLICY IF EXISTS "admins_insert_roles" ON public.user_roles;
CREATE POLICY "admins_insert_roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK ((SELECT is_admin()) AND user_id <> auth.uid());

DROP POLICY IF EXISTS "admins_update_roles" ON public.user_roles;
CREATE POLICY "admins_update_roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING ((SELECT is_admin()) AND user_id <> auth.uid())
WITH CHECK ((SELECT is_admin()) AND user_id <> auth.uid());
