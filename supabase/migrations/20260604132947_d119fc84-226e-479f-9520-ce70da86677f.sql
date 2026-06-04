DROP POLICY IF EXISTS "admins_select_spotify_tokens" ON public.spotify_tokens;
DROP POLICY IF EXISTS "admins_insert_spotify_tokens" ON public.spotify_tokens;
DROP POLICY IF EXISTS "admins_update_spotify_tokens" ON public.spotify_tokens;
DROP POLICY IF EXISTS "admins_delete_spotify_tokens" ON public.spotify_tokens;

DROP POLICY IF EXISTS "admins_select_spotify_user_tokens" ON public.spotify_user_tokens;
DROP POLICY IF EXISTS "admins_insert_spotify_user_tokens" ON public.spotify_user_tokens;
DROP POLICY IF EXISTS "admins_update_spotify_user_tokens" ON public.spotify_user_tokens;
DROP POLICY IF EXISTS "admins_delete_spotify_user_tokens" ON public.spotify_user_tokens;

-- Lock tokens to service_role only (bypasses RLS). Authenticated/anon get no access.
CREATE POLICY "deny_all_spotify_tokens" ON public.spotify_tokens
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_all_spotify_user_tokens" ON public.spotify_user_tokens
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);