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

GRANT SELECT ON public.spotify_user_tokens_public TO authenticated, anon;
GRANT ALL    ON public.spotify_user_tokens_public TO service_role;

-- Permissão de leitura APENAS nas 5 colunas seguras da tabela base.
-- Tokens/refresh/scopes/expires_at não recebem grant — continuam inacessíveis.
GRANT SELECT (id, spotify_user_id, display_name, email, is_default)
  ON public.spotify_user_tokens TO authenticated, anon;

DROP POLICY IF EXISTS "Read safe spotify account fields" ON public.spotify_user_tokens;
CREATE POLICY "Read safe spotify account fields"
  ON public.spotify_user_tokens
  FOR SELECT
  TO authenticated, anon
  USING (true);