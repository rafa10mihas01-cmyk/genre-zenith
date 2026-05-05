CREATE OR REPLACE FUNCTION public.sync_playlist_to_library()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_curator_id uuid;
  v_user_id uuid;
  v_spotify_id text;
BEGIN
  -- Só sincroniza playlists declaradas pelo curador (curator/baseline).
  -- Playlists detectadas pelo robô (organic/algorithmic/editorial/suspicious) NÃO entram na biblioteca.
  IF NEW.match_status NOT IN ('curator', 'baseline') THEN
    RETURN NEW;
  END IF;

  SELECT d.curator_id, d.user_id
    INTO v_curator_id, v_user_id
    FROM public.curator_deals d
   WHERE d.id = NEW.deal_id;

  IF v_curator_id IS NULL OR v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_spotify_id := public.extract_spotify_playlist_id(NEW.spotify_url);

  IF v_spotify_id IS NOT NULL THEN
    INSERT INTO public.curator_playlist_library
      (curator_id, user_id, spotify_playlist_id, spotify_url, playlist_name,
       followers, image_url, spotify_owner_id, spotify_owner_name,
       times_used, last_used_at)
    VALUES
      (v_curator_id, v_user_id, v_spotify_id, NEW.spotify_url, NEW.playlist_name,
       NEW.followers, NEW.image_url, NEW.spotify_owner_id, NEW.spotify_owner_name,
       1, now())
    ON CONFLICT (curator_id, spotify_playlist_id)
      WHERE spotify_playlist_id IS NOT NULL
    DO UPDATE SET
      playlist_name = COALESCE(EXCLUDED.playlist_name, public.curator_playlist_library.playlist_name),
      followers = COALESCE(EXCLUDED.followers, public.curator_playlist_library.followers),
      image_url = COALESCE(EXCLUDED.image_url, public.curator_playlist_library.image_url),
      spotify_owner_id = COALESCE(EXCLUDED.spotify_owner_id, public.curator_playlist_library.spotify_owner_id),
      spotify_owner_name = COALESCE(EXCLUDED.spotify_owner_name, public.curator_playlist_library.spotify_owner_name),
      last_used_at = now(),
      updated_at = now();
  ELSE
    INSERT INTO public.curator_playlist_library
      (curator_id, user_id, spotify_url, playlist_name,
       followers, image_url, times_used, last_used_at)
    VALUES
      (v_curator_id, v_user_id, NEW.spotify_url, NEW.playlist_name,
       NEW.followers, NEW.image_url, 1, now())
    ON CONFLICT (curator_id, lower(trim(playlist_name)))
      WHERE spotify_playlist_id IS NULL
    DO UPDATE SET
      followers = COALESCE(EXCLUDED.followers, public.curator_playlist_library.followers),
      image_url = COALESCE(EXCLUDED.image_url, public.curator_playlist_library.image_url),
      last_used_at = now(),
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$;