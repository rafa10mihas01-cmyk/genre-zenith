-- Fase 1.A.3 — rename semântico (sem mudança de regra de negócio).

-- 1) Rename de colunas
ALTER TABLE public.curator_deal_logs
  RENAME COLUMN is_baseline TO is_initial_capture_event;

ALTER TABLE public.curator_playlists
  RENAME COLUMN is_baseline TO is_initial_roster;

-- 2) Trigger function: enforce_curator_playlist_baseline → enforce_curator_playlist_initial_roster
DROP TRIGGER IF EXISTS trg_enforce_curator_playlist_baseline ON public.curator_playlists;
DROP FUNCTION IF EXISTS public.enforce_curator_playlist_baseline();

CREATE OR REPLACE FUNCTION public.enforce_curator_playlist_initial_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign_id uuid;
  v_in_baseline boolean;
BEGIN
  IF NEW.is_initial_roster = true OR NEW.spotify_playlist_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.campaign_id INTO v_campaign_id
  FROM public.curator_deals d
  WHERE d.id = NEW.deal_id;

  -- Regra oficial: não existe baseline sem campanha.
  IF v_campaign_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1
      FROM public.campaign_playlist_collections cpc
     WHERE cpc.campaign_id = v_campaign_id
       AND cpc.is_baseline = true
       AND cpc.spotify_playlist_id = NEW.spotify_playlist_id
  ) INTO v_in_baseline;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_enforce_curator_playlist_initial_roster
  BEFORE INSERT ON public.curator_playlists
  FOR EACH ROW EXECUTE FUNCTION public.enforce_curator_playlist_initial_roster();

-- 3) record_curator_deal_capture: renomear param p_is_baseline → p_is_initial_capture
DROP FUNCTION IF EXISTS public.record_curator_deal_capture(uuid, uuid, bigint, boolean, text, text[], jsonb, jsonb, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.record_curator_deal_capture(
  p_deal_id uuid,
  p_song_id uuid,
  p_total_plays bigint,
  p_is_initial_capture boolean,
  p_note text,
  p_print_urls text[],
  p_new_playlists jsonb,
  p_snapshots jsonb,
  p_captured_at timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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

  INSERT INTO public.curator_deal_logs (deal_id, total_plays, note, is_initial_capture_event, print_urls, song_id)
  VALUES (
    p_deal_id, GREATEST(p_total_plays, 0), NULLIF(p_note, ''),
    COALESCE(p_is_initial_capture, false),
    COALESCE(p_print_urls, ARRAY[]::text[]),
    p_song_id
  )
  RETURNING id INTO v_log_id;

  IF p_new_playlists IS NOT NULL AND jsonb_typeof(p_new_playlists) = 'array' THEN
    FOR v_pl IN SELECT * FROM jsonb_array_elements(p_new_playlists) LOOP
      INSERT INTO public.curator_playlists (
        deal_id, song_id, spotify_url, playlist_name, followers, is_initial_roster
      )
      VALUES (
        p_deal_id, p_song_id,
        COALESCE(v_pl->>'spotify_url', ''),
        v_pl->>'playlist_name',
        NULLIF(v_pl->>'followers','')::bigint,
        COALESCE((v_pl->>'is_initial_roster')::boolean, COALESCE(p_is_initial_capture, false))
      );
      v_inserted_playlists := v_inserted_playlists + 1;
    END LOOP;
  END IF;

  IF p_snapshots IS NOT NULL AND jsonb_typeof(p_snapshots) = 'array' THEN
    FOR v_snap IN SELECT * FROM jsonb_array_elements(p_snapshots) LOOP
      v_playlist_id := NULL;
      v_match_method := NULL;
      v_spotify_id := public.extract_spotify_playlist_id(v_snap->>'spotify_url');
      v_plays := GREATEST(COALESCE((v_snap->>'plays')::bigint, 0), 0);

      IF v_spotify_id IS NOT NULL THEN
        SELECT id INTO v_playlist_id
          FROM public.curator_playlists
         WHERE deal_id = p_deal_id AND spotify_playlist_id = v_spotify_id
         LIMIT 1;
        IF v_playlist_id IS NOT NULL THEN v_match_method := 'spotify_id'; END IF;
      END IF;

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
         ORDER BY (is_initial_roster = COALESCE(p_is_initial_capture, false)) DESC
         LIMIT 1;
        IF v_playlist_id IS NOT NULL THEN v_match_method := 'name'; END IF;

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
        print_url, is_initial_capture, source, ai_confidence, created_by, match_method
      )
      VALUES (
        p_deal_id, p_song_id, v_playlist_id, v_plays,
        COALESCE(p_captured_at, now()),
        NULLIF(v_snap->>'print_url',''),
        COALESCE(p_is_initial_capture, false),
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
$function$;

-- 4) get_curator_deal_breakdown — atualizar referência a curator_playlists.is_baseline
CREATE OR REPLACE FUNCTION public.get_curator_deal_breakdown(p_deal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_baseline bigint;
  v_target bigint;
  v_result jsonb;
  v_is_service boolean := (current_setting('request.jwt.claim.role', true) = 'service_role')
                          OR (auth.role() = 'service_role');
BEGIN
  SELECT user_id, COALESCE(baseline_plays,0), COALESCE(target_plays,0)
    INTO v_owner, v_baseline, v_target
  FROM public.curator_deals
  WHERE id = p_deal_id;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('error','deal_not_found');
  END IF;

  IF NOT v_is_service
     AND v_owner IS DISTINCT FROM auth.uid()
     AND NOT public.has_team_access() THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (s.playlist_id)
      s.playlist_id, s.plays, s.captured_at
    FROM public.curator_deal_snapshots s
    WHERE s.deal_id = p_deal_id AND s.is_initial_capture = false
    ORDER BY s.playlist_id, s.captured_at DESC
  ),
  classified AS (
    SELECT l.playlist_id, l.plays, COALESCE(p.match_status, 'organic') AS match_status
    FROM latest l
    JOIN public.curator_playlists p ON p.id = l.playlist_id
    WHERE p.is_initial_roster = false
      AND COALESCE(p.is_observational, false) = false
  ),
  agg AS (
    SELECT match_status, COUNT(*)::int AS playlists, COALESCE(SUM(plays),0)::bigint AS plays
    FROM classified GROUP BY match_status
  )
  SELECT jsonb_build_object(
    'curator', jsonb_build_object(
      'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='curator'),0),
      'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='curator'),0)
    ),
    'ecosystem', jsonb_build_object(
      'editorial', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='editorial'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='editorial'),0)
      ),
      'algorithmic', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='algorithmic'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='algorithmic'),0)
      ),
      'organic', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='organic'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='organic'),0)
      ),
      'suspicious', jsonb_build_object(
        'playlists', COALESCE((SELECT playlists FROM agg WHERE match_status='suspicious'),0),
        'plays',     COALESCE((SELECT plays     FROM agg WHERE match_status='suspicious'),0)
      )
    ),
    'total', jsonb_build_object(
      'playlists', COALESCE((SELECT SUM(playlists) FROM agg),0),
      'plays',     COALESCE((SELECT SUM(plays)     FROM agg),0)
    ),
    'baseline_plays', v_baseline,
    'target_plays',   v_target
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- 5) get_curator_deal_snapshot_history — atualizar referências
CREATE OR REPLACE FUNCTION public.get_curator_deal_snapshot_history(p_deal_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH curator_pls AS (
    SELECT id, playlist_name, image_url, spotify_url, spotify_owner_name, followers
      FROM public.curator_playlists
     WHERE deal_id = p_deal_id
       AND (
         COALESCE(match_status, 'curator') IN ('curator', 'algorithmic', 'organic')
         OR is_initial_roster = true
       )
  ),
  snaps AS (
    SELECT s.*, date_trunc('minute', s.captured_at) AS bucket
      FROM public.curator_deal_snapshots s
      LEFT JOIN public.bot_print_batches b
        ON b.id = COALESCE(s.snapshot_run_id, s.batch_id)
     WHERE s.deal_id = p_deal_id
       AND s.playlist_id IN (SELECT id FROM curator_pls)
       AND (
         COALESCE(s.snapshot_run_id, s.batch_id) IS NULL
         OR b.superseded_by IS NULL
       )
  ),
  runs AS (
    SELECT
      v.run_id,
      date_trunc('minute', v.created_at) AS bucket,
      v.created_at,
      v.song_id,
      v.print_urls
    FROM public.v_snapshot_prints v
    WHERE v.deal_id = p_deal_id
  ),
  logs AS (
    SELECT
      l.id AS log_id,
      date_trunc('minute', l.created_at) AS bucket,
      l.created_at,
      l.song_id,
      l.total_plays,
      l.is_initial_capture_event,
      l.print_urls,
      l.note
    FROM public.curator_deal_logs l
    WHERE l.deal_id = p_deal_id
  ),
  buckets AS (
    SELECT bucket FROM snaps
    UNION
    SELECT bucket FROM runs
    UNION
    SELECT bucket FROM logs
  ),
  latest_per_pl AS (
    SELECT b.bucket, cp.id AS playlist_id,
      (
        SELECT s2.plays FROM snaps s2
         WHERE s2.playlist_id = cp.id AND s2.bucket <= b.bucket
         ORDER BY s2.captured_at DESC LIMIT 1
      ) AS plays
    FROM buckets b CROSS JOIN curator_pls cp
  ),
  cumulative AS (
    SELECT b.bucket, COALESCE(SUM(lp.plays), 0)::bigint AS cumulative_total
    FROM (SELECT DISTINCT bucket FROM buckets) b
    LEFT JOIN latest_per_pl lp ON lp.bucket = b.bucket
    GROUP BY b.bucket
  ),
  bucket_logs AS (
    SELECT
      b.bucket,
      ARRAY(
        SELECT DISTINCT u
        FROM logs l, unnest(l.print_urls) AS u
        WHERE l.created_at >= b.bucket - INTERVAL '2 minutes'
          AND l.created_at <  b.bucket + INTERVAL '3 minutes'
          AND u IS NOT NULL
      ) AS log_print_urls
    FROM buckets b
  ),
  bucket_runs AS (
    SELECT
      bk.bucket,
      ARRAY(
        SELECT DISTINCT u
        FROM runs r, unnest(r.print_urls) AS u
        WHERE r.bucket = bk.bucket AND u IS NOT NULL
      ) AS run_print_urls
    FROM (SELECT DISTINCT bucket FROM buckets) bk
  ),
  bucket_meta AS (
    SELECT
      b.bucket,
      COALESCE(
        (SELECT MIN(l.created_at) FROM logs l WHERE l.bucket = b.bucket AND l.is_initial_capture_event),
        (SELECT MIN(s.captured_at) FROM snaps s WHERE s.bucket = b.bucket),
        (SELECT MIN(r.created_at)  FROM runs  r WHERE r.bucket = b.bucket),
        (SELECT MIN(l.created_at)  FROM logs  l WHERE l.bucket = b.bucket)
      ) AS captured_at,
      COALESCE(
        (SELECT bool_or(s.is_initial_capture) FROM snaps s WHERE s.bucket = b.bucket),
        false
      ) OR COALESCE(
        (SELECT bool_or(l.is_initial_capture_event) FROM logs l WHERE l.bucket = b.bucket),
        false
      ) AS is_initial_capture,
      COALESCE(
        NULLIF((SELECT COUNT(DISTINCT s.playlist_id) FROM snaps s WHERE s.bucket = b.bucket), 0),
        (SELECT COUNT(*) FROM curator_pls)
      )::int AS playlists_count,
      COALESCE(
        (SELECT l.song_id FROM logs l WHERE l.bucket = b.bucket ORDER BY l.is_initial_capture_event DESC, l.created_at DESC LIMIT 1),
        (SELECT s.song_id FROM snaps s WHERE s.bucket = b.bucket ORDER BY s.captured_at DESC LIMIT 1),
        (SELECT r.song_id FROM runs r WHERE r.bucket = b.bucket ORDER BY r.created_at DESC LIMIT 1)
      ) AS song_id,
      COALESCE(
        (SELECT l.total_plays FROM logs l WHERE l.bucket = b.bucket ORDER BY COALESCE(array_length(l.print_urls, 1), 0) DESC, l.created_at DESC LIMIT 1),
        NULLIF((SELECT c.cumulative_total FROM cumulative c WHERE c.bucket = b.bucket), 0),
        0
      )::bigint AS total_plays,
      (SELECT (ARRAY_AGG(s.print_url) FILTER (WHERE s.print_url IS NOT NULL))[1]
         FROM snaps s WHERE s.bucket = b.bucket) AS snap_print_url,
      (SELECT ARRAY(SELECT DISTINCT x
                      FROM unnest(ARRAY_AGG(s.print_url) FILTER (WHERE s.print_url IS NOT NULL)) AS t(x))
         FROM snaps s WHERE s.bucket = b.bucket) AS snap_print_urls,
      COALESCE(
        (SELECT l.note FROM logs l WHERE l.bucket = b.bucket AND l.note IS NOT NULL AND length(l.note) > 0 ORDER BY l.created_at DESC LIMIT 1),
        (SELECT (ARRAY_AGG(s.notes) FILTER (WHERE s.notes IS NOT NULL AND length(s.notes) > 0))[1]
           FROM snaps s WHERE s.bucket = b.bucket)
      ) AS note
    FROM (SELECT DISTINCT bucket FROM buckets) b
  ),
  bucket_playlists AS (
    SELECT
      s.bucket,
      jsonb_agg(
        jsonb_build_object(
          'playlist_id', cp.id,
          'playlist_name', cp.playlist_name,
          'image_url', cp.image_url,
          'spotify_url', cp.spotify_url,
          'spotify_owner_name', cp.spotify_owner_name,
          'followers', cp.followers,
          'plays', s.plays,
          'plays_7d', s.plays_7d
        )
        ORDER BY s.plays DESC NULLS LAST, cp.playlist_name ASC
      ) AS playlists
    FROM snaps s
    JOIN curator_pls cp ON cp.id = s.playlist_id
    GROUP BY s.bucket
  ),
  bucket_prints AS (
    SELECT
      bm.bucket,
      ARRAY(
        SELECT DISTINCT u
        FROM unnest(
          COALESCE(br.run_print_urls, ARRAY[]::text[]) ||
          COALESCE(bl.log_print_urls, ARRAY[]::text[]) ||
          COALESCE(bm.snap_print_urls, ARRAY[]::text[])
        ) AS u
        WHERE u IS NOT NULL
      ) AS print_urls
    FROM bucket_meta bm
    LEFT JOIN bucket_logs bl ON bl.bucket = bm.bucket
    LEFT JOIN bucket_runs br ON br.bucket = bm.bucket
  ),
  raw_entries AS (
    SELECT jsonb_build_object(
      'captured_at', bm.captured_at,
      'song_id', bm.song_id,
      'is_initial_capture', bm.is_initial_capture,
      'playlists_count', bm.playlists_count,
      'total_plays', bm.total_plays,
      'print_url', COALESCE(bp.print_urls[1], bm.snap_print_url),
      'print_urls', to_jsonb(bp.print_urls),
      'note', bm.note,
      'playlists', COALESCE(bpl.playlists, '[]'::jsonb)
    ) AS entry
    FROM bucket_meta bm
    LEFT JOIN bucket_playlists bpl ON bpl.bucket = bm.bucket
    LEFT JOIN bucket_prints bp ON bp.bucket = bm.bucket
    WHERE bm.captured_at IS NOT NULL
  ),
  ranked_entries AS (
    SELECT
      entry,
      row_number() OVER (
        PARTITION BY
          CASE
            WHEN COALESCE((entry->>'is_initial_capture')::boolean, false)
              THEN 'initial:' || COALESCE(entry->>'captured_at', random()::text)
            ELSE COALESCE(entry->>'song_id', '') || ':' || COALESCE(entry->>'captured_at', random()::text)
          END
        ORDER BY (entry->>'captured_at')::timestamptz DESC NULLS LAST
      ) AS rn
    FROM raw_entries
  ),
  ordered AS (
    SELECT entry
    FROM ranked_entries
    WHERE rn = 1
    ORDER BY (entry->>'captured_at')::timestamptz DESC NULLS LAST
  )
  SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb) FROM ordered;
$function$;