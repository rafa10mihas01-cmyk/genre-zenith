
-- 1) catalog_tracks ganha genre_id (FK pra genres) — nullable até backfill manual de faixas legadas
ALTER TABLE public.catalog_tracks
  ADD COLUMN IF NOT EXISTS genre_id uuid REFERENCES public.genres(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_catalog_tracks_genre ON public.catalog_tracks(genre_id);

-- 2) Preparação estrutural pra promoção catálogo → campanha (não usar ainda)
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS catalog_track_id uuid REFERENCES public.catalog_tracks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_catalog_track ON public.campaigns(catalog_track_id) WHERE catalog_track_id IS NOT NULL;

-- 3) Tabela de aliases Spotify → gênero interno
CREATE TABLE IF NOT EXISTS public.genre_aliases (
  alias text PRIMARY KEY,
  genre_id uuid NOT NULL REFERENCES public.genres(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.genre_aliases TO authenticated;
GRANT ALL ON public.genre_aliases TO service_role;
ALTER TABLE public.genre_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "genre_aliases_read_authenticated" ON public.genre_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "genre_aliases_admin_write" ON public.genre_aliases FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed inicial (aliases lowercased, sem acento — mesmo formato do Spotify)
INSERT INTO public.genre_aliases(alias, genre_id)
SELECT v.alias, g.id FROM genres g, (VALUES
  -- funk
  ('funk','funk'),('funk carioca','funk'),('brazilian funk','funk'),('favela funk','funk'),
  ('baile funk','funk'),('funk 150 bpm','funk'),('funk consciente','funk'),
  ('funk mandelao','funk'),('funk ostentacao','funk'),('funk paulista','funk'),
  ('funk bh','funk'),('funk rj','funk'),('funk pop','funk'),('funk melody','funk'),
  ('funk das antigas','funk'),
  -- trap
  ('trap','trap'),('brazilian trap','trap'),('trap brasileiro','trap'),
  ('trap latino','trap'),('trap funk','trap'),('latin trap','trap'),
  -- sertanejo
  ('sertanejo','sertanejo'),('sertanejo universitario','sertanejo'),
  ('sertanejo pop','sertanejo'),('sertanejo romantico','sertanejo'),
  ('modao','sertanejo'),('sofrencia','sertanejo'),
  -- agro (subconjunto de sertanejo "agro" — gênero comercial separado no negócio)
  ('agro','agro'),('sertanejo agro','agro'),('musica agro','agro'),('agronejo','agro'),
  -- pagode
  ('pagode','pagode'),('pagode baiano','pagode'),('pagode novo','pagode'),
  ('pagode romantico','pagode'),('samba','pagode'),('samba-pagode','pagode'),('partido alto','pagode'),
  -- forró
  ('forro','forró'),('forro tradicional','forró'),('forro pe de serra','forró'),
  ('forro eletronico','forró'),('xote','forró'),
  -- piseiro
  ('piseiro','piseiro'),('piseiro romantico','piseiro'),
  -- pop
  ('pop','pop'),('brazilian pop','pop'),('mpb','pop'),('pop nacional','pop'),
  ('pop rock brasileiro','pop'),
  -- rap
  ('rap','rap'),('rap nacional','rap'),('rap brasileiro','rap'),
  ('hip hop','rap'),('hip hop brasileiro','rap'),('hip hop tuga','rap'),
  -- axé
  ('axe','axé'),('axe music','axé'),('samba-reggae','axé'),
  -- eletrofunk
  ('eletrofunk','eletrofunk'),('electro funk','eletrofunk'),
  ('eletro funk','eletrofunk'),('funk eletronico','eletrofunk'),
  -- reggaeton
  ('reggaeton','reggaeton'),('latin urban','reggaeton'),('perreo','reggaeton')
) AS v(alias, genre_slug)
WHERE g.slug = v.genre_slug
ON CONFLICT (alias) DO NOTHING;

-- 4) RPC preview (dry-run, não persiste)
CREATE OR REPLACE FUNCTION public.preview_distribute_catalog_track(
  p_spotify_track_id text,
  p_genre_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_track_id uuid;
  v_track_exists boolean := false;
  v_genre_name text;
  v_pool_total int := 0;
  v_cap_total int := 0;
  v_cap_used int := 0;
  v_cap_free int := 0;
  v_eligible jsonb;
  v_already jsonb;
  v_no_capacity jsonb;
BEGIN
  IF p_genre_id IS NULL THEN
    RAISE EXCEPTION 'genre_id obrigatório';
  END IF;
  SELECT nome INTO v_genre_name FROM genres WHERE id = p_genre_id;
  IF v_genre_name IS NULL THEN
    RAISE EXCEPTION 'genre_id inválido';
  END IF;

  SELECT id INTO v_track_id FROM catalog_tracks WHERE spotify_track_id = p_spotify_track_id;
  v_track_exists := v_track_id IS NOT NULL;

  WITH pool AS (
    SELECT mp.id, mp.name, mp.cover_url, mp.followers, mp.catalog_capacity,
           COALESCE(o.available_slots, mp.catalog_capacity) AS available_slots,
           (cp.managed_playlist_id IS NOT NULL) AS is_present
    FROM managed_playlists mp
    LEFT JOIN v_catalog_playlist_occupancy o ON o.managed_playlist_id = mp.id
    LEFT JOIN catalog_placements cp
      ON cp.managed_playlist_id = mp.id
     AND cp.catalog_track_id = v_track_id
     AND cp.status <> 'removed'
    WHERE mp.is_catalog = true
      AND mp.archived_at IS NULL
      AND mp.genre_id = p_genre_id
  )
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(catalog_capacity),0)::int,
    COALESCE(SUM(catalog_capacity - available_slots),0)::int,
    COALESCE(SUM(available_slots),0)::int,
    COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'cover_url',cover_url,'followers',followers,'available_slots',available_slots)
      ORDER BY followers DESC NULLS LAST)
      FILTER (WHERE NOT is_present AND available_slots > 0), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'cover_url',cover_url,'followers',followers)
      ORDER BY followers DESC NULLS LAST)
      FILTER (WHERE is_present), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'cover_url',cover_url,'followers',followers)
      ORDER BY followers DESC NULLS LAST)
      FILTER (WHERE NOT is_present AND available_slots <= 0), '[]'::jsonb)
  INTO v_pool_total, v_cap_total, v_cap_used, v_cap_free, v_eligible, v_already, v_no_capacity
  FROM pool;

  RETURN jsonb_build_object(
    'ok', true,
    'track_exists', v_track_exists,
    'genre_id', p_genre_id,
    'genre_name', v_genre_name,
    'genre_pool_total', v_pool_total,
    'genre_capacity_total', v_cap_total,
    'genre_capacity_used', v_cap_used,
    'genre_capacity_free', v_cap_free,
    'eligible', v_eligible,
    'already_present', v_already,
    'no_capacity', v_no_capacity,
    'eligible_count', jsonb_array_length(v_eligible),
    'already_present_count', jsonb_array_length(v_already),
    'no_capacity_count', jsonb_array_length(v_no_capacity)
  );
END;
$$;

-- 5) distribute_catalog_track passa a exigir genre_id + filtra pool por gênero
DROP FUNCTION IF EXISTS public.distribute_catalog_track(text, text, text, text, text, text, integer, bigint, bigint, jsonb, uuid);
CREATE OR REPLACE FUNCTION public.distribute_catalog_track(
  p_spotify_track_id text,
  p_genre_id uuid,
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
) RETURNS jsonb
LANGUAGE plpgsql
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
  v_prev_genre_id uuid;
BEGIN
  IF p_spotify_track_id IS NULL OR length(trim(p_spotify_track_id))=0 THEN
    RAISE EXCEPTION 'spotify_track_id obrigatório';
  END IF;
  IF p_genre_id IS NULL THEN
    RAISE EXCEPTION 'genre_id obrigatório';
  END IF;
  IF p_track_name IS NULL OR p_artist_name IS NULL THEN
    RAISE EXCEPTION 'track_name e artist_name obrigatórios';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM genres WHERE id = p_genre_id) THEN
    RAISE EXCEPTION 'genre_id inválido';
  END IF;

  SELECT * INTO v_track_row FROM catalog_tracks WHERE spotify_track_id = p_spotify_track_id;
  IF NOT FOUND THEN
    INSERT INTO catalog_tracks(
      spotify_track_id, spotify_uri, isrc, track_name, artist_name,
      cover_url, added_by, status, genre_id
    ) VALUES (
      p_spotify_track_id, p_spotify_uri, p_isrc, p_track_name, p_artist_name,
      p_cover_url, p_added_by, 'active', p_genre_id
    ) RETURNING * INTO v_track_row;
    v_is_new := true;

    INSERT INTO catalog_track_baselines(catalog_track_id, streams, popularity, monthly_listeners, raw_payload)
    VALUES (v_track_row.id, p_baseline_streams, p_baseline_popularity, p_baseline_monthly_listeners, p_baseline_raw);
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

  -- Cálculo de elegíveis (pool restrita por gênero)
  WITH pool AS (
    SELECT mp.id AS managed_playlist_id, mp.catalog_capacity,
           COALESCE(o.available_slots, mp.catalog_capacity) AS available_slots,
           (cp.managed_playlist_id IS NOT NULL) AS is_present
    FROM managed_playlists mp
    LEFT JOIN v_catalog_playlist_occupancy o ON o.managed_playlist_id = mp.id
    LEFT JOIN catalog_placements cp
      ON cp.managed_playlist_id = mp.id
     AND cp.catalog_track_id = v_track_id
     AND cp.status <> 'removed'
    WHERE mp.is_catalog = true
      AND mp.archived_at IS NULL
      AND mp.genre_id = p_genre_id
  )
  SELECT
    COUNT(*) FILTER (WHERE NOT is_present AND available_slots > 0),
    COUNT(*) FILTER (WHERE is_present),
    COUNT(*) FILTER (WHERE NOT is_present AND available_slots <= 0)
  INTO v_total_eligible_playlists, v_skipped_already_present, v_skipped_no_capacity
  FROM pool;

  INSERT INTO catalog_distribution_batches(
    catalog_track_id, triggered_by,
    total_eligible_playlists, skipped_already_present,
    skipped_no_capacity, placements_created
  ) VALUES (
    v_track_id, p_added_by,
    v_total_eligible_playlists, v_skipped_already_present,
    v_skipped_no_capacity, 0
  ) RETURNING id INTO v_batch_id;

  WITH pool AS (
    SELECT mp.id AS managed_playlist_id,
           COALESCE(o.available_slots, mp.catalog_capacity) AS available_slots,
           (cp.managed_playlist_id IS NOT NULL) AS is_present
    FROM managed_playlists mp
    LEFT JOIN v_catalog_playlist_occupancy o ON o.managed_playlist_id = mp.id
    LEFT JOIN catalog_placements cp
      ON cp.managed_playlist_id = mp.id
     AND cp.catalog_track_id = v_track_id
     AND cp.status <> 'removed'
    WHERE mp.is_catalog = true
      AND mp.archived_at IS NULL
      AND mp.genre_id = p_genre_id
  ),
  inserted AS (
    INSERT INTO catalog_placements(catalog_track_id, managed_playlist_id, status, distribution_batch_id)
    SELECT v_track_id, p.managed_playlist_id, 'pending', v_batch_id
    FROM pool p
    WHERE NOT p.is_present AND p.available_slots > 0
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_placements_created FROM inserted;

  UPDATE catalog_distribution_batches SET placements_created = v_placements_created WHERE id = v_batch_id;

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
      'genre_id', v_track_row.genre_id,
      'is_new', v_is_new,
      'previous_genre_id', v_prev_genre_id,
      'genre_changed', (NOT v_is_new AND v_prev_genre_id IS DISTINCT FROM p_genre_id)
    ),
    'distribution_batch_id', v_batch_id,
    'total_eligible_playlists', v_total_eligible_playlists,
    'skipped_already_present', v_skipped_already_present,
    'skipped_no_capacity', v_skipped_no_capacity,
    'placements_created', v_placements_created
  );
END;
$$;
