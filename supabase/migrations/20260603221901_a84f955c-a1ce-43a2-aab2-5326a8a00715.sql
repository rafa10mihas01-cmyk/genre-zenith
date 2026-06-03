
-- =========================================================================
-- FASE 1+2: snapshot_run_id columns linking to bot_print_batches
-- =========================================================================
ALTER TABLE public.curator_deal_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_run_id uuid
  REFERENCES public.bot_print_batches(id) ON DELETE SET NULL;

ALTER TABLE public.song_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_run_id uuid
  REFERENCES public.bot_print_batches(id) ON DELETE SET NULL;

ALTER TABLE public.campaign_playlist_collections
  ADD COLUMN IF NOT EXISTS snapshot_run_id uuid
  REFERENCES public.bot_print_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cds_snapshot_run ON public.curator_deal_snapshots(snapshot_run_id) WHERE snapshot_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ss_snapshot_run  ON public.song_snapshots(snapshot_run_id)        WHERE snapshot_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cpc_snapshot_run ON public.campaign_playlist_collections(snapshot_run_id) WHERE snapshot_run_id IS NOT NULL;

-- =========================================================================
-- FASE 4: View única v_snapshot_prints — fonte oficial
-- (campaign_id derivado via curator_deals)
-- =========================================================================
CREATE OR REPLACE VIEW public.v_snapshot_prints AS
SELECT
  b.id              AS run_id,
  b.deal_id,
  b.song_id,
  cd.campaign_id    AS campaign_id,
  b.created_at,
  b.completed_at,
  CASE
    WHEN jsonb_typeof(b.print_urls) = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(b.print_urls))
    ELSE ARRAY[]::text[]
  END AS print_urls,
  CASE
    WHEN jsonb_typeof(b.print_urls) = 'array'
      THEN jsonb_array_length(b.print_urls)
    ELSE 0
  END AS print_count
FROM public.bot_print_batches b
LEFT JOIN public.curator_deals cd ON cd.id = b.deal_id;

GRANT SELECT ON public.v_snapshot_prints TO authenticated, service_role;

-- =========================================================================
-- FASE 3: RPC ingest_campaign_collection_batch aceita p_snapshot_run_id.
-- Quando preenchido, NÃO grava proof_screenshot_url(s) — referencia apenas.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.ingest_campaign_collection_batch(
  p_campaign_id      uuid,
  p_intent           text,
  p_rows             jsonb,
  p_snapshot_run_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id UUID := gen_random_uuid();
  v_baseline_status TEXT;
  v_is_baseline BOOLEAN;
  v_now TIMESTAMPTZ := now();
  v_rows_count INT;
  v_inserted INT;
BEGIN
  IF p_intent NOT IN ('baseline','periodic') THEN
    RAISE EXCEPTION 'invalid_intent: must be baseline or periodic';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'invalid_rows: expected jsonb array';
  END IF;

  v_rows_count := jsonb_array_length(p_rows);

  SELECT baseline_status INTO v_baseline_status
  FROM public.campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF v_baseline_status IS NULL THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  IF p_intent = 'baseline' AND v_baseline_status = 'captured' THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'baseline_already_captured',
      'campaign_id', p_campaign_id
    );
  END IF;

  v_is_baseline := (p_intent = 'baseline');

  INSERT INTO public.campaign_playlist_collections
    (campaign_id, playlist_id, playlist_url, playlist_name_at_capture,
     plays_7d, captured_at, is_baseline, source,
     proof_screenshot_url, proof_screenshot_urls, collection_run_id,
     snapshot_run_id)
  SELECT
    p_campaign_id,
    r->>'playlist_id',
    r->>'playlist_url',
    r->>'playlist_name_at_capture',
    COALESCE((r->>'plays_7d')::BIGINT, 0),
    v_now,
    v_is_baseline,
    COALESCE(r->>'source', 's4a_dom'),
    CASE WHEN p_snapshot_run_id IS NOT NULL THEN NULL
      ELSE COALESCE(
        (CASE
          WHEN jsonb_typeof(r->'proof_screenshot_urls') = 'array'
               AND jsonb_array_length(r->'proof_screenshot_urls') > 0
          THEN (r->'proof_screenshot_urls'->>0)
        END),
        r->>'proof_screenshot_url'
      )
    END,
    CASE WHEN p_snapshot_run_id IS NOT NULL THEN ARRAY[]::TEXT[]
      ELSE COALESCE(
        CASE
          WHEN jsonb_typeof(r->'proof_screenshot_urls') = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(r->'proof_screenshot_urls'))
        END,
        CASE
          WHEN r->>'proof_screenshot_url' IS NOT NULL
          THEN ARRAY[r->>'proof_screenshot_url']
          ELSE ARRAY[]::TEXT[]
        END
      )
    END,
    v_run_id,
    p_snapshot_run_id
  FROM jsonb_array_elements(p_rows) r
  WHERE r->>'playlist_id' IS NOT NULL
    AND length(trim(r->>'playlist_id')) > 0;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_is_baseline AND v_inserted > 0 THEN
    UPDATE public.campaigns
       SET baseline_status = 'captured',
           baseline_captured_at = v_now,
           updated_at = v_now
     WHERE id = p_campaign_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'campaign_id', p_campaign_id,
    'intent', p_intent,
    'collection_run_id', v_run_id,
    'snapshot_run_id', p_snapshot_run_id,
    'rows_received', v_rows_count,
    'rows_inserted', v_inserted
  );
END;
$function$;

-- =========================================================================
-- FASE 5: get_curator_deal_snapshot_history — ENXERGA prints via
-- v_snapshot_prints (suporta coletas vindas da nova pipeline).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_curator_deal_snapshot_history(p_deal_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH curator_pls AS (
    SELECT id, playlist_name, image_url, spotify_url, spotify_owner_name, followers
      FROM public.curator_playlists
     WHERE deal_id = p_deal_id AND match_status = 'curator'
  ),
  snaps AS (
    SELECT s.*, date_trunc('minute', s.captured_at) AS bucket
      FROM public.curator_deal_snapshots s
     WHERE s.deal_id = p_deal_id
       AND s.playlist_id IN (SELECT id FROM curator_pls)
  ),
  runs AS (
    SELECT
      v.run_id,
      date_trunc('minute', v.created_at) AS bucket,
      v.created_at,
      v.print_urls
    FROM public.v_snapshot_prints v
    WHERE v.deal_id = p_deal_id
  ),
  buckets AS (
    SELECT bucket FROM snaps
    UNION
    SELECT bucket FROM runs
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
    SELECT bucket, COALESCE(SUM(plays), 0)::bigint AS cumulative_total
    FROM latest_per_pl
    GROUP BY bucket
  ),
  bucket_logs AS (
    SELECT
      b.bucket,
      ARRAY(
        SELECT DISTINCT u
        FROM public.curator_deal_logs l, unnest(l.print_urls) AS u
        WHERE l.deal_id = p_deal_id
          AND l.created_at >= b.bucket - INTERVAL '2 minutes'
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
        (SELECT MIN(s.captured_at) FROM snaps s WHERE s.bucket = b.bucket),
        (SELECT MIN(r.created_at)  FROM runs  r WHERE r.bucket = b.bucket)
      ) AS captured_at,
      COALESCE(
        (SELECT bool_or(s.is_baseline) FROM snaps s WHERE s.bucket = b.bucket),
        false
      ) AS is_baseline,
      COALESCE(
        (SELECT COUNT(DISTINCT s.playlist_id) FROM snaps s WHERE s.bucket = b.bucket),
        0
      )::int AS playlists_count,
      (SELECT (ARRAY_AGG(s.print_url) FILTER (WHERE s.print_url IS NOT NULL))[1]
         FROM snaps s WHERE s.bucket = b.bucket) AS snap_print_url,
      (SELECT ARRAY(SELECT DISTINCT x
                      FROM unnest(ARRAY_AGG(s.print_url) FILTER (WHERE s.print_url IS NOT NULL)) AS t(x))
         FROM snaps s WHERE s.bucket = b.bucket) AS snap_print_urls,
      (SELECT (ARRAY_AGG(s.notes) FILTER (WHERE s.notes IS NOT NULL AND length(s.notes) > 0))[1]
         FROM snaps s WHERE s.bucket = b.bucket) AS note
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
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'captured_at', bm.captured_at,
      'is_baseline', bm.is_baseline,
      'playlists_count', bm.playlists_count,
      'total_plays', c.cumulative_total,
      'print_url', COALESCE(bp.print_urls[1], bm.snap_print_url),
      'print_urls', to_jsonb(bp.print_urls),
      'note', bm.note,
      'playlists', COALESCE(bpl.playlists, '[]'::jsonb)
    ) ORDER BY bm.captured_at ASC),
    '[]'::jsonb
  )
  FROM bucket_meta bm
  JOIN cumulative c ON c.bucket = bm.bucket
  LEFT JOIN bucket_playlists bpl ON bpl.bucket = bm.bucket
  LEFT JOIN bucket_prints bp ON bp.bucket = bm.bucket;
$function$;

-- =========================================================================
-- FASE 6: Backfill Toma Botadão (collection_run_id 8110e10f...)
-- =========================================================================
DO $backfill$
DECLARE
  v_deal_id    uuid := '2193c4a4-a26a-4b0c-974b-b56a6a228dfb';
  v_song_id    uuid := '25545301-5fd6-4227-810a-5ac4461e5cbb';
  v_snapshot   record;
  v_batch_id   uuid;
  v_count_cpc  int;
BEGIN
  SELECT id, screenshot_url, captured_at, snapshot_run_id
    INTO v_snapshot
    FROM public.song_snapshots
   WHERE song_id = v_song_id AND screenshot_url IS NOT NULL
   ORDER BY captured_at ASC
   LIMIT 1;

  IF v_snapshot.id IS NULL THEN
    RAISE NOTICE 'Toma Botadão: nenhum song_snapshots com screenshot — backfill ignorado';
    RETURN;
  END IF;

  v_batch_id := v_snapshot.snapshot_run_id;

  IF v_batch_id IS NULL THEN
    INSERT INTO public.bot_print_batches
      (deal_id, song_id, batch_key, total_parts, received_parts,
       print_paths, print_urls, status, created_at, completed_at, processed_at)
    VALUES
      (v_deal_id, v_song_id,
       'backfill-toma-botadao-' || v_snapshot.id::text,
       1, 1,
       '[]'::jsonb,
       jsonb_build_array(v_snapshot.screenshot_url),
       'complete',
       v_snapshot.captured_at,
       v_snapshot.captured_at,
       now())
    RETURNING id INTO v_batch_id;

    UPDATE public.song_snapshots
       SET snapshot_run_id = v_batch_id
     WHERE id = v_snapshot.id;
  END IF;

  UPDATE public.campaign_playlist_collections cpc
     SET snapshot_run_id = v_batch_id
   WHERE cpc.collection_run_id = '8110e10f-f3e2-4634-955b-d275947efa65'
     AND cpc.snapshot_run_id IS NULL;

  GET DIAGNOSTICS v_count_cpc = ROW_COUNT;

  RAISE NOTICE 'Toma Botadão backfill OK: batch=% collections_linked=%',
    v_batch_id, v_count_cpc;
END
$backfill$;
