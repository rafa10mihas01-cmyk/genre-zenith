-- =====================================================================
-- FASE 1 — Função atômica de distribuição no catálogo
-- =====================================================================
-- Recebe dados já resolvidos da música (Spotify). Faz find_or_create
-- da música, cria baseline T0 se nova, e distribui placements para
-- todas as playlists do catálogo onde a música ainda não está e que
-- têm vaga disponível. Tudo em uma única transação.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.distribute_catalog_track(
  p_spotify_track_id text,
  p_spotify_uri text DEFAULT NULL,
  p_isrc text DEFAULT NULL,
  p_track_name text DEFAULT NULL,
  p_artist_name text DEFAULT NULL,
  p_cover_url text DEFAULT NULL,
  p_baseline_popularity integer DEFAULT NULL,
  p_baseline_monthly_listeners bigint DEFAULT NULL,
  p_baseline_streams bigint DEFAULT NULL,
  p_baseline_raw jsonb DEFAULT NULL,
  p_added_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_track_id uuid;
  v_is_new boolean := false;
  v_batch_id uuid;
  v_total_eligible_playlists int := 0;
  v_skipped_already_present int := 0;
  v_skipped_no_capacity int := 0;
  v_placements_created int := 0;
  v_track_row catalog_tracks%ROWTYPE;
BEGIN
  -- Validação mínima
  IF p_spotify_track_id IS NULL OR length(trim(p_spotify_track_id)) = 0 THEN
    RAISE EXCEPTION 'spotify_track_id obrigatório';
  END IF;
  IF p_track_name IS NULL OR p_artist_name IS NULL THEN
    RAISE EXCEPTION 'track_name e artist_name obrigatórios';
  END IF;

  -- 1) find_or_create da música
  SELECT * INTO v_track_row
  FROM catalog_tracks
  WHERE spotify_track_id = p_spotify_track_id;

  IF NOT FOUND THEN
    INSERT INTO catalog_tracks (
      spotify_track_id, spotify_uri, isrc, track_name, artist_name,
      cover_url, added_by, status
    ) VALUES (
      p_spotify_track_id, p_spotify_uri, p_isrc, p_track_name, p_artist_name,
      p_cover_url, p_added_by, 'active'
    )
    RETURNING * INTO v_track_row;
    v_is_new := true;

    -- 2) Baseline T0 apenas para músicas novas (UNIQUE garante 1 por música)
    INSERT INTO catalog_track_baselines (
      catalog_track_id, streams, popularity, monthly_listeners, raw_payload
    ) VALUES (
      v_track_row.id, p_baseline_streams, p_baseline_popularity,
      p_baseline_monthly_listeners, p_baseline_raw
    );
  ELSE
    -- Música já existe: opcionalmente atualiza campos que possam ter chegado vazios
    UPDATE catalog_tracks SET
      spotify_uri = COALESCE(spotify_uri, p_spotify_uri),
      isrc        = COALESCE(isrc, p_isrc),
      cover_url   = COALESCE(cover_url, p_cover_url)
    WHERE id = v_track_row.id
      AND (
        (v_track_row.spotify_uri IS NULL AND p_spotify_uri IS NOT NULL) OR
        (v_track_row.isrc        IS NULL AND p_isrc        IS NOT NULL) OR
        (v_track_row.cover_url   IS NULL AND p_cover_url   IS NOT NULL)
      );
  END IF;

  v_track_id := v_track_row.id;

  -- 3) Calcula os 3 conjuntos numa CTE única
  WITH catalog_pool AS (
    SELECT id AS managed_playlist_id, catalog_capacity
    FROM managed_playlists
    WHERE is_catalog = true
  ),
  already_present AS (
    SELECT cp.managed_playlist_id
    FROM catalog_placements cp
    WHERE cp.catalog_track_id = v_track_id
      AND cp.status <> 'removed'
  ),
  pool_minus_present AS (
    SELECT cpool.managed_playlist_id, cpool.catalog_capacity
    FROM catalog_pool cpool
    WHERE cpool.managed_playlist_id NOT IN (SELECT managed_playlist_id FROM already_present)
  ),
  occupancy AS (
    SELECT managed_playlist_id, available_slots
    FROM v_catalog_playlist_occupancy
  ),
  eligible AS (
    SELECT pmp.managed_playlist_id
    FROM pool_minus_present pmp
    LEFT JOIN occupancy o ON o.managed_playlist_id = pmp.managed_playlist_id
    WHERE COALESCE(o.available_slots, pmp.catalog_capacity) > 0
  )
  SELECT
    (SELECT count(*) FROM catalog_pool),
    (SELECT count(*) FROM already_present),
    (SELECT count(*) FROM pool_minus_present) - (SELECT count(*) FROM eligible)
  INTO v_total_eligible_playlists, v_skipped_already_present, v_skipped_no_capacity;

  -- 4) Cria o batch de auditoria (placements_created atualiza no fim)
  INSERT INTO catalog_distribution_batches (
    catalog_track_id, triggered_by,
    total_eligible_playlists, skipped_already_present,
    skipped_no_capacity, placements_created
  ) VALUES (
    v_track_id, p_added_by,
    v_total_eligible_playlists, v_skipped_already_present,
    v_skipped_no_capacity, 0
  )
  RETURNING id INTO v_batch_id;

  -- 5) Insere placements nas elegíveis com vaga
  -- ON CONFLICT DO NOTHING como rede de proteção contra qualquer race
  WITH catalog_pool AS (
    SELECT id AS managed_playlist_id, catalog_capacity
    FROM managed_playlists
    WHERE is_catalog = true
  ),
  already_present AS (
    SELECT managed_playlist_id
    FROM catalog_placements
    WHERE catalog_track_id = v_track_id AND status <> 'removed'
  ),
  pool_minus_present AS (
    SELECT cpool.managed_playlist_id, cpool.catalog_capacity
    FROM catalog_pool cpool
    WHERE cpool.managed_playlist_id NOT IN (SELECT managed_playlist_id FROM already_present)
  ),
  occupancy AS (
    SELECT managed_playlist_id, available_slots
    FROM v_catalog_playlist_occupancy
  ),
  eligible AS (
    SELECT pmp.managed_playlist_id
    FROM pool_minus_present pmp
    LEFT JOIN occupancy o ON o.managed_playlist_id = pmp.managed_playlist_id
    WHERE COALESCE(o.available_slots, pmp.catalog_capacity) > 0
  ),
  inserted AS (
    INSERT INTO catalog_placements (
      catalog_track_id, managed_playlist_id, status, distribution_batch_id
    )
    SELECT v_track_id, e.managed_playlist_id, 'pending', v_batch_id
    FROM eligible e
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_placements_created FROM inserted;

  -- 6) Atualiza o batch com o real de placements criados
  UPDATE catalog_distribution_batches
  SET placements_created = v_placements_created
  WHERE id = v_batch_id;

  -- 7) Retorna o resumo operacional
  RETURN jsonb_build_object(
    'ok', true,
    'track', jsonb_build_object(
      'id', v_track_row.id,
      'spotify_track_id', v_track_row.spotify_track_id,
      'spotify_uri', v_track_row.spotify_uri,
      'isrc', v_track_row.isrc,
      'track_name', v_track_row.track_name,
      'artist_name', v_track_row.artist_name,
      'cover_url', v_track_row.cover_url,
      'is_new', v_is_new
    ),
    'distribution_batch_id', v_batch_id,
    'total_eligible_playlists', v_total_eligible_playlists,
    'skipped_already_present', v_skipped_already_present,
    'skipped_no_capacity', v_skipped_no_capacity,
    'placements_created', v_placements_created
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.distribute_catalog_track(
  text, text, text, text, text, text, integer, bigint, bigint, jsonb, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.distribute_catalog_track(
  text, text, text, text, text, text, integer, bigint, bigint, jsonb, uuid
) TO service_role;