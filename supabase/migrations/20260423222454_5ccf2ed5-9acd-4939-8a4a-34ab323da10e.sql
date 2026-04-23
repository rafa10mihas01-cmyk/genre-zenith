-- Remove as policies "team_*" que davam acesso a qualquer curador/admin
DROP POLICY IF EXISTS team_select_spotify_user_tokens ON public.spotify_user_tokens;
DROP POLICY IF EXISTS team_insert_spotify_user_tokens ON public.spotify_user_tokens;
DROP POLICY IF EXISTS team_update_spotify_user_tokens ON public.spotify_user_tokens;
DROP POLICY IF EXISTS team_delete_spotify_user_tokens ON public.spotify_user_tokens;

-- Apenas admins podem manipular tokens do Spotify a partir do client
CREATE POLICY admins_select_spotify_user_tokens
  ON public.spotify_user_tokens
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY admins_insert_spotify_user_tokens
  ON public.spotify_user_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY admins_update_spotify_user_tokens
  ON public.spotify_user_tokens
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY admins_delete_spotify_user_tokens
  ON public.spotify_user_tokens
  FOR DELETE
  TO authenticated
  USING (public.is_admin());