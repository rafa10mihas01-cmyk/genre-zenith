
-- 1. Drop dead permissive policies (service_role bypasses RLS anyway)
DROP POLICY IF EXISTS "service role manages curator access logs" ON public.curator_access_logs;
DROP POLICY IF EXISTS "service role manages curator OTPs" ON public.curator_access_otps;

-- 2. Explicit anon deny on spotify_invite_tokens for clarity/defense-in-depth
CREATE POLICY "deny anon access to spotify invite tokens"
ON public.spotify_invite_tokens
AS RESTRICTIVE
FOR ALL
TO anon
USING (false)
WITH CHECK (false);
