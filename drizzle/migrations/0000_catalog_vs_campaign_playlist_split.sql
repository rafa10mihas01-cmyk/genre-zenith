DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.engine_create_distribution_plan(uuid,smallint)'::regprocedure);
  d := replace(d, 'AND mp.execution_mode = ''API_READY''
    AND NOT EXISTS', 'AND mp.execution_mode = ''API_READY''
    AND mp.playlist_type = ''CATALOG''::public.playlist_type_enum
    AND NOT EXISTS');
  IF position('playlist_type = ''CATALOG''' in d) = 0 THEN RAISE EXCEPTION 'plan patch failed'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.preview_distribute_catalog_track(text,uuid)'::regprocedure);
  d := replace(d, 'AND COALESCE(mp.operational_status, '''') <> ''do_not_operate''
  )', 'AND COALESCE(mp.operational_status, '''') <> ''do_not_operate''
      AND mp.playlist_type = ''CATALOG''::public.playlist_type_enum
  )');
  IF position('playlist_type = ''CATALOG''' in d) = 0 THEN RAISE EXCEPTION 'preview patch failed'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.engine_place_catalog_track_on_playlist(uuid,uuid,boolean)'::regprocedure);
  d := replace(d, 'IF v_present AND NOT p_allow_duplicate THEN',
    'IF v_present AND (NOT p_allow_duplicate OR v_mp.playlist_type <> ''CAMPAIGN''::public.playlist_type_enum) THEN');
  IF position('<> ''CAMPAIGN''' in d) = 0 THEN RAISE EXCEPTION 'place patch failed'; END IF;
  EXECUTE d;
END $$;