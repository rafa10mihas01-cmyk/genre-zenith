
-- Habilita pg_trgm pra fuzzy match (ignora se já existir)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) Coluna de auditoria do método de match
ALTER TABLE public.curator_deal_snapshots
  ADD COLUMN IF NOT EXISTS match_method text;

COMMENT ON COLUMN public.curator_deal_snapshots.match_method IS
  'Como a playlist foi resolvida: spotify_id | name | fuzzy | manual';

-- 2) RPC atômica com matching em camadas (id → name → fuzzy)
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
SET search_path = public, extensions
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
  v_match_method text;
  v_spotify_id text;
  v_normalized_name text;
  v_plays bigint;
  v_fuzzy_score real;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_deal_owner FROM public.curator_deals WHERE id = p_deal_id;
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

  -- Log
  INSERT INTO public.curator_deal_logs (deal_id, total_plays, note, is_baseline, print_urls, song_id)
  VALUES (
    p_deal_id, GREATEST(p_total_plays, 0), NULLIF(p_note, ''),
    COALESCE(p_is_baseline, false),
    COALESCE(p_print_urls, ARRAY[]::text[]),
    p_song_id
  )
  RETURNING id INTO v_log_id;

  -- Novas playlists
  IF p_new_playlists IS NOT NULL AND jsonb_typeof(p_new_playlists) = 'array' THEN
    FOR v_pl IN SELECT * FROM jsonb_array_elements(p_new_playlists) LOOP
      INSERT INTO public.curator_playlists (
        deal_id, song_id, spotify_url, playlist_name, followers, is_baseline
      )
      VALUES (
        p_deal_id, p_song_id,
        COALESCE(v_pl->>'spotify_url', ''),
        v_pl->>'playlist_name',
        NULLIF(v_pl->>'followers','')::bigint,
        COALESCE((v_pl->>'is_baseline')::boolean, COALESCE(p_is_baseline, false))
      );
      v_inserted_playlists := v_inserted_playlists + 1;
    END LOOP;
  END IF;

  -- Snapshots com matching em camadas
  IF p_snapshots IS NOT NULL AND jsonb_typeof(p_snapshots) = 'array' THEN
    FOR v_snap IN SELECT * FROM jsonb_array_elements(p_snapshots) LOOP
      v_playlist_id := NULL;
      v_match_method := NULL;
      v_spotify_id := public.extract_spotify_playlist_id(v_snap->>'spotify_url');
      v_plays := GREATEST(COALESCE((v_snap->>'plays')::bigint, 0), 0);

      -- 1) match por spotify_playlist_id
      IF v_spotify_id IS NOT NULL THEN
        SELECT id INTO v_playlist_id
          FROM public.curator_playlists
         WHERE deal_id = p_deal_id AND spotify_playlist_id = v_spotify_id
         LIMIT 1;
        IF v_playlist_id IS NOT NULL THEN v_match_method := 'spotify_id'; END IF;
      END IF;

      -- 2) match por nome normalizado
      IF v_playlist_id IS NULL AND (v_snap->>'playlist_name') IS NOT NULL THEN
        v_normalized_name := trim(lower(regexp_replace(
          translate(v_snap->>'playlist_name',
            'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
            'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
          '[^a-zA-Z0-9]+', ' ', 'g'
        )));

        SELECT id INTO v_playlist_id
          FROM public.curator_playlists
         WHERE deal_id = p_deal_id
           AND trim(lower(regexp_replace(
             translate(playlist_name,
               'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
               'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
             '[^a-zA-Z0-9]+', ' ', 'g'
           ))) = v_normalized_name
         ORDER BY (is_baseline = COALESCE(p_is_baseline, false)) DESC
         LIMIT 1;
        IF v_playlist_id IS NOT NULL THEN v_match_method := 'name'; END IF;

        -- 3) fuzzy fallback (similaridade ≥ 0.6)
        IF v_playlist_id IS NULL THEN
          SELECT id, similarity(
            trim(lower(regexp_replace(
              translate(playlist_name,
                'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
              '[^a-zA-Z0-9]+', ' ', 'g'
            ))),
            v_normalized_name
          )
          INTO v_playlist_id, v_fuzzy_score
            FROM public.curator_playlists
           WHERE deal_id = p_deal_id
           ORDER BY 2 DESC
           LIMIT 1;

          IF v_playlist_id IS NOT NULL AND COALESCE(v_fuzzy_score, 0) >= 0.6 THEN
            v_match_method := 'fuzzy';
          ELSE
            v_playlist_id := NULL;
          END IF;
        END IF;
      END IF;

      IF v_playlist_id IS NULL THEN
        v_skipped_snapshots := v_skipped_snapshots + 1;
        CONTINUE;
      END IF;

      INSERT INTO public.curator_deal_snapshots (
        deal_id, song_id, playlist_id, plays, captured_at,
        print_url, is_baseline, source, ai_confidence, created_by, match_method
      )
      VALUES (
        p_deal_id, p_song_id, v_playlist_id, v_plays,
        COALESCE(p_captured_at, now()),
        NULLIF(v_snap->>'print_url',''),
        COALESCE(p_is_baseline, false),
        COALESCE(NULLIF(v_snap->>'source',''), 'spotify_for_artists'),
        NULLIF(v_snap->>'ai_confidence','')::numeric,
        v_user_id,
        v_match_method
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

-- 3) Progresso usando is_baseline como fonte oficial
CREATE OR REPLACE FUNCTION public.get_curator_deal_progress(p_deal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_target bigint := 0;
  v_daily_goal bigint := 0;
BEGIN
  SELECT COALESCE(target_plays, 0), COALESCE(daily_goal, 0)
    INTO v_target, v_daily_goal
  FROM public.curator_deals WHERE id = p_deal_id;

  WITH snaps AS (
    SELECT s.playlist_id, s.plays, s.captured_at, s.is_baseline
      FROM public.curator_deal_snapshots s
     WHERE s.deal_id = p_deal_id
  ),
  -- Baseline oficial: snapshot mais antigo com is_baseline=true.
  -- Fallback (dados antigos sem flag): primeiro snapshot da playlist.
  baseline_per_playlist AS (
    SELECT playlist_id,
           COALESCE(
             (SELECT plays FROM snaps s2
               WHERE s2.playlist_id = s.playlist_id AND s2.is_baseline
               ORDER BY captured_at ASC LIMIT 1),
             (SELECT plays FROM snaps s3
               WHERE s3.playlist_id = s.playlist_id
               ORDER BY captured_at ASC LIMIT 1)
           ) AS baseline_plays,
           COALESCE(
             (SELECT captured_at FROM snaps s2
               WHERE s2.playlist_id = s.playlist_id AND s2.is_baseline
               ORDER BY captured_at ASC LIMIT 1),
             (SELECT captured_at FROM snaps s3
               WHERE s3.playlist_id = s.playlist_id
               ORDER BY captured_at ASC LIMIT 1)
           ) AS baseline_at
      FROM snaps s
     GROUP BY playlist_id
  ),
  latest_per_playlist AS (
    SELECT DISTINCT ON (playlist_id)
           playlist_id, plays AS latest_plays, captured_at AS last_captured_at
      FROM snaps
     ORDER BY playlist_id, captured_at DESC
  ),
  per_playlist AS (
    SELECT
      b.playlist_id,
      cp.playlist_name,
      cp.is_baseline AS playlist_is_baseline,
      b.baseline_plays,
      b.baseline_at,
      l.latest_plays,
      l.last_captured_at,
      GREATEST(COALESCE(l.latest_plays, 0) - COALESCE(b.baseline_plays, 0), 0) AS delivered,
      (SELECT COUNT(*) FROM snaps s WHERE s.playlist_id = b.playlist_id AND s.captured_at > b.baseline_at)::int AS snapshot_count
    FROM baseline_per_playlist b
    LEFT JOIN latest_per_playlist l ON l.playlist_id = b.playlist_id
    LEFT JOIN public.curator_playlists cp ON cp.id = b.playlist_id
  ),
  totals AS (
    SELECT
      COALESCE(SUM(delivered) FILTER (WHERE NOT COALESCE(playlist_is_baseline, false)), 0) AS delivered_curator,
      COALESCE(SUM(delivered), 0) AS delivered_total,
      COALESCE(SUM(baseline_plays) FILTER (WHERE NOT COALESCE(playlist_is_baseline, false)), 0) AS baseline_curator,
      COALESCE(SUM(latest_plays) FILTER (WHERE NOT COALESCE(playlist_is_baseline, false)), 0) AS latest_curator
    FROM per_playlist
  ),
  range_info AS (
    SELECT MIN(captured_at) AS first_capture, MAX(captured_at) AS last_capture FROM snaps
  )
  SELECT jsonb_build_object(
    'deal_id', p_deal_id,
    'target_plays', v_target,
    'daily_goal', v_daily_goal,
    'baseline_total', t.baseline_curator,
    'latest_total', t.latest_curator,
    'delivered_curator', t.delivered_curator,
    'delivered_total', t.delivered_total,
    'first_capture_at', r.first_capture,
    'last_capture_at', r.last_capture,
    'days_elapsed', CASE
      WHEN r.first_capture IS NULL OR r.last_capture IS NULL THEN 0
      ELSE GREATEST(EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) / 86400.0, 0)
    END,
    'daily_avg', CASE
      WHEN r.first_capture IS NULL OR r.last_capture IS NULL
        OR EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) <= 0 THEN 0
      ELSE t.delivered_curator / (EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) / 86400.0)
    END,
    'progress_pct', CASE
      WHEN v_target <= 0 THEN 0
      ELSE LEAST(100, ROUND((t.delivered_curator::numeric / v_target::numeric) * 100, 1))
    END,
    'eta_days', CASE
      WHEN v_target <= 0 OR t.delivered_curator >= v_target THEN 0
      WHEN r.first_capture IS NULL OR r.last_capture IS NULL
        OR EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) <= 0 THEN NULL
      ELSE CEIL(
        (v_target - t.delivered_curator)::numeric
        / NULLIF(t.delivered_curator / (EXTRACT(EPOCH FROM (r.last_capture - r.first_capture)) / 86400.0), 0)
      )
    END,
    'per_playlist', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'playlist_id', pp.playlist_id,
        'playlist_name', pp.playlist_name,
        'is_baseline', pp.playlist_is_baseline,
        'baseline_plays', pp.baseline_plays,
        'latest_plays', pp.latest_plays,
        'delivered', pp.delivered,
        'last_captured_at', pp.last_captured_at,
        'snapshot_count', pp.snapshot_count
      ) ORDER BY pp.delivered DESC) FROM per_playlist pp),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM totals t CROSS JOIN range_info r;

  RETURN COALESCE(v_result, jsonb_build_object(
    'deal_id', p_deal_id,
    'target_plays', v_target,
    'daily_goal', v_daily_goal,
    'baseline_total', 0, 'latest_total', 0,
    'delivered_curator', 0, 'delivered_total', 0,
    'daily_avg', 0, 'days_elapsed', 0,
    'progress_pct', 0, 'eta_days', NULL,
    'per_playlist', '[]'::jsonb
  ));
END;
$$;
