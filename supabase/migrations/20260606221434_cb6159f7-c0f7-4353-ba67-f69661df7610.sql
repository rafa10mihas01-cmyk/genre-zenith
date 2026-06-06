-- 1. Drop permissive SELECT policy that exposed tokens to anon + authenticated
DROP POLICY IF EXISTS "Read safe spotify account fields" ON public.spotify_user_tokens;

-- 2. Add explicit restrictive policy: only service_role can SELECT the base table
CREATE POLICY "Service role only reads tokens"
  ON public.spotify_user_tokens
  FOR SELECT
  TO service_role
  USING (true);

-- 3. Recreate safe public view (adds app_id; bypasses RLS via definer view)
DROP VIEW IF EXISTS public.spotify_user_tokens_public;
CREATE VIEW public.spotify_user_tokens_public
WITH (security_invoker = off) AS
SELECT id, spotify_user_id, display_name, email, is_default, app_id
FROM public.spotify_user_tokens;

GRANT SELECT ON public.spotify_user_tokens_public TO authenticated;
GRANT SELECT ON public.spotify_user_tokens_public TO anon;