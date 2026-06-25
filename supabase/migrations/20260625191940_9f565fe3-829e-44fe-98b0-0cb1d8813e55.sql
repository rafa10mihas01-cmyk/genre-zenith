
CREATE OR REPLACE FUNCTION public.distribute_catalog_track(
  p_spotify_track_id text,
  p_genre_id uuid,
  p_spotify_uri text DEFAULT NULL::text,
  p_isrc text DEFAULT NULL::text,
  p_track_name text DEFAULT NULL::text,
  p_artist_name text DEFAULT NULL::text,
  p_cover_url text DEFAULT NULL::text,
  p_baseline_popularity integer DEFAULT NULL::integer,
  p_baseline_monthly_listeners bigint DEFAULT NULL::bigint,
  p_baseline_streams bigint DEFAULT NULL::bigint,
  p_baseline_raw jsonb DEFAULT NULL::jsonb,
  p_added_by uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_track_row catalog_tracks%ROWTYPE;
  v_track_id uuid;
  v_is_new boolean := false;
  v_prev_genre_id uuid;
  v_plan_id uuid;
  v_total_targets int := 0;
  v_wave record;
BEGIN
  IF p_spotify_track_id IS NULL OR length(trim(p_spotify_track_id))=0 THEN
    RAISE EXCEPTION 'spotify_track_id obrigatório';
  END IF;
  IF p_genre_id IS NULL THEN RAISE EXCEPTION 'genre_id obrigatório'; END IF;
  IF p_track_name IS NULL OR p_artist_name IS NULL THEN
    RAISE EXCEPTION 'track_name e artist_name obrigatórios';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM genres WHERE id = p_genre_id) THEN
    RAISE EXCEPTION 'genre_id inválido';
  END IF;

  SELECT * INTO v_track_row FROM catalog_tracks WHERE spotify_track_id = p_spotify_track_id;
  IF NOT FOUND THEN
    INSERT INTO catalog_tracks(spotify_track_id, spotify_uri, isrc, track_name, artist_name, cover_url, added_by, status, genre_id)
    VALUES (p_spotify_track_id, p_spotify_uri, p_isrc, p_track_name, p_artist_name, p_cover_url, p_added_by, 'active', p_genre_id)
    RETURNING * INTO v_track_row;
    v_is_new := true;
    -- LEGACY: pipeline catalog_track_baselines descontinuado. Não inserir mais placeholders.
    -- Métricas operacionais agora vêm de song_snapshots / song_snapshot_playlists (pipeline SONG).
  ELSE
    v_prev_genre_id := v_track_row.genre_id;
    UPDATE catalog_tracks SET
      spotify_uri = COALESCE(spotify_uri, p_spotify_uri),
      isrc        = COALESCE(isrc, p_isrc),
      cover_url   = COALESCE(cover_url, p_cover_url),
      genre_id    = p_genre_id,
      updated_at  = now()
    WHERE id = v_track_row.id;
    v_track_row.genre_id := p_genre_id;
  END IF;

  v_track_id := v_track_row.id;

  v_plan_id := public.engine_create_distribution_plan(v_track_id, NULL);

  SELECT COALESCE(total_eligible,0) INTO v_total_targets
    FROM public.catalog_distribution_plans WHERE id = v_plan_id;

  IF v_total_targets > 0 THEN
    SELECT * INTO v_wave FROM public.engine_run_distribution_wave(NULL);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'natural',
    'track', jsonb_build_object(
      'id', v_track_row.id,
      'spotify_track_id', v_track_row.spotify_track_id,
      'spotify_uri', v_track_row.spotify_uri,
      'isrc', v_track_row.isrc,
      'track_name', v_track_row.track_name,
      'artist_name', v_track_row.artist_name,
      'cover_url', v_track_row.cover_url,
      'genre_id', v_track_row.genre_id,
      'is_new', v_is_new,
      'previous_genre_id', v_prev_genre_id,
      'genre_changed', (NOT v_is_new AND v_prev_genre_id IS DISTINCT FROM p_genre_id)
    ),
    'distribution_plan_id', v_plan_id,
    'total_targets', v_total_targets,
    'first_wave_distributed', COALESCE(v_wave.distributed,0),
    'first_wave_remaining', COALESCE(v_wave.remaining, v_total_targets),
    'capped', false
  );
END $function$;

COMMENT ON TABLE public.catalog_track_baselines IS 'LEGACY — pipeline descontinuado em favor de song_snapshots + song_snapshot_playlists. Mantida apenas para histórico.';
COMMENT ON TABLE public.catalog_track_snapshots IS 'LEGACY — pipeline descontinuado em favor de song_snapshots + song_snapshot_playlists.';
COMMENT ON TABLE public.catalog_snapshot_queue IS 'LEGACY — fila do pipeline baseline antigo. Cron de enfileiramento pausado.';
