CREATE OR REPLACE FUNCTION public.get_community_invite_by_code(p_code text)
RETURNS TABLE(
  id uuid,
  email text,
  expires_at timestamptz,
  status text,
  invited_by_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ci.id,
    ci.email,
    ci.expires_at,
    CASE
      WHEN ci.status = 'pending' AND ci.expires_at < now() THEN 'expired'
      ELSE ci.status
    END AS status,
    'Equipe NexEngine'::text AS invited_by_name
  FROM public.community_invites ci
  WHERE lower(ci.code) = lower(p_code)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.accept_community_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_invite record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  UPDATE public.community_invites
     SET status = 'expired', updated_at = now()
   WHERE lower(code) = lower(p_code)
     AND status = 'pending'
     AND expires_at < now();

  SELECT * INTO v_invite
    FROM public.community_invites
   WHERE lower(code) = lower(p_code)
   LIMIT 1;

  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;
  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'invite_not_available';
  END IF;
  IF v_invite.email IS NOT NULL AND lower(v_invite.email) <> lower(coalesce(v_email,'')) THEN
    RAISE EXCEPTION 'invite_email_mismatch';
  END IF;

  UPDATE public.community_invites
     SET status = 'accepted', accepted_by = v_uid, accepted_at = now(), updated_at = now()
   WHERE id = v_invite.id
     AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'invite_id', v_invite.id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_community_invite_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_community_invite_by_code(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.accept_community_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_community_invite(text) TO authenticated;