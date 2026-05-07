
DROP FUNCTION IF EXISTS public.get_community_invite_by_code(text);
DROP FUNCTION IF EXISTS public.accept_community_invite(text);

CREATE OR REPLACE FUNCTION public.get_community_invite_by_code(p_code text)
RETURNS TABLE(
  id uuid, email text, expires_at timestamptz, status text, invited_by_name text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.community_invites
     SET status = 'expired'
   WHERE lower(code) = lower(p_code)
     AND status = 'pending'
     AND expires_at < now();

  RETURN QUERY
  SELECT ci.id,
         ci.email,
         ci.expires_at,
         ci.status,
         COALESCE(p.full_name, p.email, 'Equipe NexEngine') AS invited_by_name
    FROM public.community_invites ci
    LEFT JOIN public.profiles p ON p.id = ci.invited_by
   WHERE lower(ci.code) = lower(p_code)
   LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_community_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
     SET status = 'expired'
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
     SET accepted_by = v_uid, updated_at = now()
   WHERE id = v_invite.id;

  RETURN jsonb_build_object('ok', true, 'invite_id', v_invite.id);
END;
$$;
