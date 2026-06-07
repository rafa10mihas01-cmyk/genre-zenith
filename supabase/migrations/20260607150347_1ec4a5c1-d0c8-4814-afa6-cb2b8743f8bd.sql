
CREATE OR REPLACE FUNCTION public.get_spotify_token_status()
RETURNS TABLE(expires_at timestamptz, expired boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT expires_at, (expires_at <= now()) AS expired
  FROM public.spotify_tokens
  WHERE singleton_key = 'app'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_spotify_token_status() TO authenticated, service_role;
