CREATE OR REPLACE FUNCTION public.get_community_invite_by_code(p_code text)
RETURNS TABLE(id uuid, email text, expires_at timestamp with time zone, status text, invited_by_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.community_invites ci
     SET status = 'expired'
   WHERE lower(ci.code) = lower(p_code)
     AND ci.status = 'pending'
     AND ci.expires_at < now();

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
$function$;