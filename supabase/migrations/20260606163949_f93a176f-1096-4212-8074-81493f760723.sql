CREATE OR REPLACE VIEW public.spotify_user_tokens_public
WITH (security_invoker = on) AS
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

DROP POLICY IF EXISTS "Read public spotify accounts" ON public.spotify_user_tokens;
CREATE POLICY "Read public spotify accounts"
  ON public.spotify_user_tokens
  FOR SELECT
  TO authenticated, anon
  USING (true);