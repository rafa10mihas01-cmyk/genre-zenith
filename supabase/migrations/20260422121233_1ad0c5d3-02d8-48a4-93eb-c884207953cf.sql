
-- Backfill: cria account pra cada token existente que ainda não tem
INSERT INTO public.accounts (spotify_user_token_id, spotify_user_id, display_name, email, status, max_playlists, current_playlists)
SELECT t.id, t.spotify_user_id, COALESCE(t.display_name, t.spotify_user_id), t.email, 'active', 15, 0
FROM public.spotify_user_tokens t
LEFT JOIN public.accounts a ON a.spotify_user_token_id = t.id
WHERE a.id IS NULL;

-- Trigger: toda vez que um novo token Spotify é salvo, auto-criar uma account ativa
CREATE OR REPLACE FUNCTION public.auto_create_account_for_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.accounts (spotify_user_token_id, spotify_user_id, display_name, email, status, max_playlists, current_playlists)
  VALUES (NEW.id, NEW.spotify_user_id, COALESCE(NEW.display_name, NEW.spotify_user_id), NEW.email, 'active', 15, 0)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_account ON public.spotify_user_tokens;
CREATE TRIGGER trg_auto_create_account
AFTER INSERT ON public.spotify_user_tokens
FOR EACH ROW EXECUTE FUNCTION public.auto_create_account_for_token();
