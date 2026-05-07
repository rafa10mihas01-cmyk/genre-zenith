CREATE OR REPLACE FUNCTION public.get_community_invite_by_code(p_code text)
RETURNS TABLE (
  id uuid,
  code text,
  email text,
  status text,
  expires_at timestamptz,
  invited_by_name text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    i.id,
    i.code,
    i.email,
    CASE
      WHEN i.status = 'pending' AND i.expires_at < now() THEN 'expired'
      ELSE i.status
    END AS status,
    i.expires_at,
    COALESCE(p.email, 'NexEngine') AS invited_by_name
  FROM public.community_invites i
  LEFT JOIN auth.users p ON p.id = i.invited_by
  WHERE lower(i.code) = lower(p_code)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_community_invite_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_community_invite_by_code(text) TO anon, authenticated;

-- RPC para o membro consumir o convite após criar conta (vincula invite ao user_id)
CREATE OR REPLACE FUNCTION public.accept_community_invite(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.community_invites%ROWTYPE;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_invite FROM public.community_invites
   WHERE lower(code) = lower(p_code) FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF v_invite.status <> 'pending' OR v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  UPDATE public.community_invites
     SET status = 'accepted',
         accepted_at = now(),
         accepted_by = v_uid
   WHERE id = v_invite.id;

  RETURN v_invite.id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_community_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_community_invite(text) TO authenticated;