
REVOKE SELECT (document, phone) ON public.clients FROM authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_client_pii(_client_id uuid)
RETURNS TABLE (document text, phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.document, c.phone
  FROM public.clients c
  WHERE c.id = _client_id
    AND public.has_role(auth.uid(), 'admin'::app_role);
$$;
REVOKE ALL ON FUNCTION public.admin_get_client_pii(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_client_pii(uuid) TO authenticated;

REVOKE SELECT (pix_key, pix_type, document, phone) ON public.curators FROM authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_curator_pii(_curator_id uuid)
RETURNS TABLE (pix_key text, pix_type text, document text, phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.pix_key, c.pix_type, c.document, c.phone
  FROM public.curators c
  WHERE c.id = _curator_id
    AND public.has_role(auth.uid(), 'admin'::app_role);
$$;
REVOKE ALL ON FUNCTION public.admin_get_curator_pii(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_curator_pii(uuid) TO authenticated;

REVOKE SELECT (access_token) ON public.spotify_tokens FROM authenticated;
REVOKE SELECT (access_token, refresh_token) ON public.spotify_user_tokens FROM authenticated;
