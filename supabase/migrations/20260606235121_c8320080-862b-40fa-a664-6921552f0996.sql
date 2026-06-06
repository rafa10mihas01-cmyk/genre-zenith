
-- 1) RESTRICTIVE deny on spotify_user_tokens for non-service roles
DROP POLICY IF EXISTS deny_client_access_tokens ON public.spotify_user_tokens;
CREATE POLICY deny_client_access_tokens
  ON public.spotify_user_tokens
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- 2) Convert campaign_access_otps client policy to RESTRICTIVE
DROP POLICY IF EXISTS "No direct client access to OTPs" ON public.campaign_access_otps;
CREATE POLICY "No direct client access to OTPs"
  ON public.campaign_access_otps
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- 3) Recreate spotify_user_tokens_public as SECURITY INVOKER
ALTER VIEW public.spotify_user_tokens_public SET (security_invoker = on);
