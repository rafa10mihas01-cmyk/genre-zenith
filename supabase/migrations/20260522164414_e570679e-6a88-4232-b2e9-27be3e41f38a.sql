CREATE OR REPLACE FUNCTION public.match_curator_playlist(p_deal_id uuid, p_spotify_playlist_id text, p_playlist_name text, p_song_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(playlist_id uuid, match_method text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id uuid;
  v_normalized text;
  v_score real;
BEGIN
  IF p_spotify_playlist_id IS NOT NULL AND length(p_spotify_playlist_id) > 0 THEN
    SELECT id INTO v_id
      FROM public.curator_playlists
     WHERE deal_id = p_deal_id
       AND spotify_playlist_id = p_spotify_playlist_id
       AND (p_song_id IS NULL OR song_id IS NULL OR song_id = p_song_id)
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, 'spotify_id'::text; RETURN;
    END IF;
  END IF;

  IF p_playlist_name IS NULL OR length(trim(p_playlist_name)) = 0 THEN
    RETURN;
  END IF;

  v_normalized := trim(lower(regexp_replace(
    translate(p_playlist_name,
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
    '[^a-zA-Z0-9]+', ' ', 'g'
  )));

  SELECT id INTO v_id
    FROM public.curator_playlists
   WHERE deal_id = p_deal_id
     AND (p_song_id IS NULL OR song_id IS NULL OR song_id = p_song_id)
     AND trim(lower(regexp_replace(
       translate(playlist_name,
         'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
         'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
       '[^a-zA-Z0-9]+', ' ', 'g'
     ))) = v_normalized
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, 'name'::text; RETURN;
  END IF;

  SELECT id, similarity(
    trim(lower(regexp_replace(
      translate(playlist_name,
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
      '[^a-zA-Z0-9]+', ' ', 'g'
    ))),
    v_normalized
  )
  INTO v_id, v_score
    FROM public.curator_playlists
   WHERE deal_id = p_deal_id
     AND (p_song_id IS NULL OR song_id IS NULL OR song_id = p_song_id)
   ORDER BY 2 DESC
   LIMIT 1;

  IF v_id IS NOT NULL AND COALESCE(v_score, 0) >= 0.85 THEN
    RETURN QUERY SELECT v_id, 'fuzzy'::text; RETURN;
  END IF;
END;
$function$;