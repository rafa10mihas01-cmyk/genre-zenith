DROP POLICY IF EXISTS "Read public spotify accounts" ON public.spotify_user_tokens;

DROP VIEW IF EXISTS public.spotify_user_tokens_public;

CREATE VIEW public.spotify_user_tokens_public
WITH (security_invoker = off) AS
SELECT
  id,
  spotify_user_id,
  display_name,
  email,
  is_default
FROM public.spotify_user_tokens;

GRANT SELECT ON public.spotify_user_tokens_public TO authenticated;
GRANT SELECT ON public.spotify_user_tokens_public TO anon;
GRANT ALL  ON public.spotify_user_tokens_public TO service_role;