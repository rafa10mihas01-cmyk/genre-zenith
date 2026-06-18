ALTER VIEW public.vw_campaign_playlist_growth SET (security_invoker = true);
ALTER VIEW public.vw_campaign_playlist_delivery_origin SET (security_invoker = true);

CREATE OR REPLACE FUNCTION public.validate_public_token_state(_revoked_at timestamp with time zone, _expires_at timestamp with time zone)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _revoked_at IS NOT NULL THEN 'revoked'
    WHEN _expires_at IS NOT NULL AND _expires_at < now() THEN 'expired'
    ELSE 'valid'
  END;
$$;