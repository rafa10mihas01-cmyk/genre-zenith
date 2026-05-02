
CREATE OR REPLACE FUNCTION public.record_curator_deal_capture(
  p_deal_id uuid,
  p_song_id uuid,
  p_total_plays bigint,
  p_is_baseline boolean,
  p_note text,
  p_print_urls text[],
  p_new_playlists jsonb,
  p_snapshots jsonb,
  p_captured_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_deal_owner uuid;
  v_log_id uuid;
  v_inserted_playlists int := 0;
  v_inserted_snapshots int := 0;
  v_skipped_snapshots int := 0;
  v_pl jsonb;
  v_snap jsonb;
  v_playlist_id uuid;
  v_spotify_id text;
  v_normalized_name text;
  v_plays bigint;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_deal_owner
    FROM public.curator_deals
   WHERE id = p_deal_id;
  IF v_deal_owner IS NULL THEN
    RAISE EXCEPTION 'deal not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_deal_owner <> v_user_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_song_id IS NOT NULL THEN
    PERFORM 1 FROM public.curator_deal_songs
      WHERE id = p_song_id AND deal_id = p_deal_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'song does not belong to deal' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- 1) Log (histórico)
  INSERT INTO public.curator_deal_logs (deal_id, total_plays, note, is_baseline, print_urls, song_id)
  VALUES (
    p_deal_id,
    GREATEST(p_total_plays, 0),
    NULLIF(p_note, ''),
    COALESCE(p_is_baseline, false),
    COALESCE(p_print_urls, ARRAY[]::text[]),
    p_song_id
  )
  RETURNING id INTO v_log_id;

  -- 2) Novas playlists (insere primeiro pra estarem disponíveis no match dos snapshots)
  IF p_new_playlists IS NOT NULL AND jsonb_typeof(p_new_playlists) = 'array' THEN
    FOR v_pl IN SELECT * FROM jsonb_array_elements(p_new_playlists) LOOP
      INSERT INTO public.curator_playlists (
        deal_id, song_id, spotify_url, playlist_name, followers, is_baseline
      )
      VALUES (
        p_deal_id,
        p_song_id,
        COALESCE(v_pl->>'spotify_url', ''),
        v_pl->>'playlist_name',
        NULLIF(v_pl->>'followers','')::bigint,
        COALESCE((v_pl->>'is_baseline')::boolean, COALESCE(p_is_baseline, false))
      );
      v_inserted_playlists := v_inserted_playlists + 1;
    END LOOP;
  END IF;

  -- 3) Snapshots — resolve playlist_id por spotify_id ou por nome normalizado
  IF p_snapshots IS NOT NULL AND jsonb_typeof(p_snapshots) = 'array' THEN
    FOR v_snap IN SELECT * FROM jsonb_array_elements(p_snapshots) LOOP
      v_playlist_id := NULL;
      v_spotify_id := public.extract_spotify_playlist_id(v_snap->>'spotify_url');
      v_plays := GREATEST(COALESCE((v_snap->>'plays')::bigint, 0), 0);

      IF v_spotify_id IS NOT NULL THEN
        SELECT id INTO v_playlist_id
          FROM public.curator_playlists
         WHERE deal_id = p_deal_id
           AND spotify_playlist_id = v_spotify_id
         LIMIT 1;
      END IF;

      IF v_playlist_id IS NULL AND (v_snap->>'playlist_name') IS NOT NULL THEN
        v_normalized_name := lower(regexp_replace(
          translate(v_snap->>'playlist_name',
            'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
            'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
          '[^a-zA-Z0-9]+', ' ', 'g'
        ));
        v_normalized_name := trim(v_normalized_name);

        SELECT id INTO v_playlist_id
          FROM public.curator_playlists
         WHERE deal_id = p_deal_id
           AND lower(regexp_replace(
             translate(playlist_name,
               'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
               'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
             '[^a-zA-Z0-9]+', ' ', 'g'
           )) = v_normalized_name
         ORDER BY (is_baseline = COALESCE(p_is_baseline, false)) DESC
         LIMIT 1;
      END IF;

      IF v_playlist_id IS NULL THEN
        v_skipped_snapshots := v_skipped_snapshots + 1;
        CONTINUE;
      END IF;

      INSERT INTO public.curator_deal_snapshots (
        deal_id, song_id, playlist_id, plays, captured_at,
        print_url, is_baseline, source, ai_confidence, created_by
      )
      VALUES (
        p_deal_id,
        p_song_id,
        v_playlist_id,
        v_plays,
        COALESCE(p_captured_at, now()),
        NULLIF(v_snap->>'print_url',''),
        COALESCE(p_is_baseline, false),
        COALESCE(NULLIF(v_snap->>'source',''), 'spotify_for_artists'),
        NULLIF(v_snap->>'ai_confidence','')::numeric,
        v_user_id
      );
      v_inserted_snapshots := v_inserted_snapshots + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'log_id', v_log_id,
    'inserted_playlists', v_inserted_playlists,
    'inserted_snapshots', v_inserted_snapshots,
    'skipped_snapshots', v_skipped_snapshots
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_curator_deal_capture(uuid, uuid, bigint, boolean, text, text[], jsonb, jsonb, timestamptz) TO authenticated;
