
DO $$
DECLARE
  v_count_tokens int;
  v_count_accounts int;
BEGIN
  SELECT count(*) INTO v_count_tokens FROM public.spotify_user_tokens;
  SELECT count(*) INTO v_count_accounts FROM public.accounts;
  RAISE NOTICE 'tokens=% accounts=%', v_count_tokens, v_count_accounts;

  INSERT INTO public.accounts (spotify_user_token_id, spotify_user_id, display_name, email, status, max_playlists, current_playlists)
  SELECT t.id, t.spotify_user_id, COALESCE(t.display_name, t.spotify_user_id), t.email, 'active', 15, 0
  FROM public.spotify_user_tokens t
  WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.spotify_user_token_id = t.id);
END $$;
