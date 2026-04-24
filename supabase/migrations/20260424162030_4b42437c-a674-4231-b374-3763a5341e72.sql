
-- ============================================
-- AUDITORIA #13 — FASE 1: Segurança crítica
-- ============================================

-- 1.1 Restringir get_cron_secret() — apenas service_role pode chamar
REVOKE EXECUTE ON FUNCTION public.get_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;

-- 1.2 Adicionar bound: current_playlists não pode exceder max_playlists
ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_current_within_max;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_current_within_max
  CHECK (current_playlists <= max_playlists);

-- 1.3 Remover CHECKs duplicados em playlist_templates.performance_class
ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS chk_playlist_templates_perfclass;
ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS playlist_templates_performance_class_check;
-- mantém apenas chk_playlist_templates_perf_class

-- 1.4 Hardenizar increment_account_playlists para respeitar bound
CREATE OR REPLACE FUNCTION public.increment_account_playlists(p_spotify_user_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new integer;
BEGIN
  UPDATE public.accounts
     SET current_playlists = current_playlists + 1,
         updated_at = now()
   WHERE spotify_user_id = p_spotify_user_id
     AND current_playlists < max_playlists  -- 🔒 bound
   RETURNING current_playlists INTO v_new;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'account % at capacity or not found', p_spotify_user_id
      USING ERRCODE = '23514';
  END IF;
  RETURN v_new;
END;
$function$;

-- 1.5 Atualizar auto_create_account_for_token para sincronizar email/display_name
CREATE OR REPLACE FUNCTION public.auto_create_account_for_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.accounts (
    spotify_user_token_id, spotify_user_id, display_name, email,
    status, max_playlists, current_playlists
  )
  VALUES (
    NEW.id, NEW.spotify_user_id, COALESCE(NEW.display_name, NEW.spotify_user_id),
    NEW.email, 'active', 15, 0
  )
  ON CONFLICT (spotify_user_id) DO UPDATE
    SET spotify_user_token_id = EXCLUDED.spotify_user_token_id,
        display_name = COALESCE(EXCLUDED.display_name, public.accounts.display_name),
        email = COALESCE(EXCLUDED.email, public.accounts.email),
        updated_at = now();
  RETURN NEW;
END;
$function$;
