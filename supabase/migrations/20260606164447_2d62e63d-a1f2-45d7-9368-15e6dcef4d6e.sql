DROP POLICY IF EXISTS "deny_all_spotify_user_tokens" ON public.spotify_user_tokens;
DROP POLICY IF EXISTS "Read public spotify accounts" ON public.spotify_user_tokens;
DROP POLICY IF EXISTS "Read safe spotify account fields" ON public.spotify_user_tokens;

DROP VIEW IF EXISTS public.spotify_user_tokens_public;

CREATE VIEW public.spotify_user_tokens_public
WITH (security_invoker = on) AS
SELECT
  id,
  spotify_user_id,
  display_name,
  email,
  is_default
FROM public.spotify_user_tokens;

REVOKE ALL ON public.spotify_user_tokens_public FROM anon, authenticated;
GRANT SELECT ON public.spotify_user_tokens_public TO authenticated, anon;
GRANT ALL ON public.spotify_user_tokens_public TO service_role;

GRANT SELECT (id, spotify_user_id, display_name, email, is_default)
  ON public.spotify_user_tokens TO authenticated, anon;
GRANT ALL ON public.spotify_user_tokens TO service_role;

CREATE POLICY "Read safe spotify account fields"
  ON public.spotify_user_tokens
  FOR SELECT
  TO authenticated, anon
  USING (true);