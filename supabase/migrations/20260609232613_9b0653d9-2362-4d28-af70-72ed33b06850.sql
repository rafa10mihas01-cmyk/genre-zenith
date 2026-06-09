
-- 1. Schema
ALTER TABLE public.label_spreadsheet_uploads
  ADD COLUMN IF NOT EXISTS upload_mode text NOT NULL DEFAULT 'periodic'
    CHECK (upload_mode IN ('baseline','periodic','correction','partial_window')),
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz,
  ADD COLUMN IF NOT EXISTS quarantine_reason text,
  ADD COLUMN IF NOT EXISTS quarantine_signals jsonb,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.label_spreadsheet_uploads(id),
  ADD COLUMN IF NOT EXISTS window_kind text
    CHECK (window_kind IN ('all_time','last_28d','last_7d','last_24h','unknown'));

UPDATE public.label_spreadsheet_uploads
   SET upload_mode = CASE WHEN is_baseline THEN 'baseline' ELSE 'periodic' END
 WHERE upload_mode = 'periodic';

ALTER TABLE public.campaign_playlist_collections
  ADD COLUMN IF NOT EXISTS upload_id uuid REFERENCES public.label_spreadsheet_uploads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclusion_reason text;

CREATE INDEX IF NOT EXISTS idx_cpc_upload ON public.campaign_playlist_collections(upload_id);
CREATE INDEX IF NOT EXISTS idx_cpc_excluded ON public.campaign_playlist_collections(campaign_id, excluded);

-- Backfill upload_id
WITH deal_camp AS (
  SELECT cd.id AS deal_id, cd.campaign_id FROM public.curator_deals cd WHERE cd.campaign_id IS NOT NULL
),
matches AS (
  SELECT DISTINCT ON (c.id) c.id AS coll_id, u.id AS upload_id
    FROM public.campaign_playlist_collections c
    JOIN deal_camp dc ON dc.campaign_id = c.campaign_id
    JOIN public.label_spreadsheet_uploads u ON u.deal_id = dc.deal_id
   WHERE c.source = 'label_spreadsheet' AND c.upload_id IS NULL
     AND ABS(EXTRACT(EPOCH FROM (c.captured_at - u.created_at))) < 7200
   ORDER BY c.id, ABS(EXTRACT(EPOCH FROM (c.captured_at - u.created_at)))
)
UPDATE public.campaign_playlist_collections c
   SET upload_id = m.upload_id
  FROM matches m WHERE c.id = m.coll_id;

-- 2. Quarentena retroativa de duplicatas (mantém o mais antigo)
WITH ranked AS (
  SELECT id, deal_id, content_hash,
         ROW_NUMBER() OVER (PARTITION BY deal_id, content_hash ORDER BY created_at ASC, id ASC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY deal_id, content_hash ORDER BY created_at ASC, id ASC) AS first_id
    FROM public.label_spreadsheet_uploads
   WHERE content_hash IS NOT NULL AND quarantined_at IS NULL
)
UPDATE public.label_spreadsheet_uploads u
   SET quarantined_at = now(),
       quarantine_reason = 'duplicate_content',
       quarantine_signals = jsonb_build_object('duplicate_of', r.first_id),
       status = 'quarantined'
  FROM ranked r
 WHERE u.id = r.id AND r.rn > 1;

-- 3. Quarentena Carnívoro 09/06
UPDATE public.label_spreadsheet_uploads
   SET quarantined_at = now(),
       quarantine_reason = 'partial_window_detected',
       window_kind = 'last_7d',
       upload_mode = 'partial_window',
       status = 'quarantined',
       quarantine_signals = jsonb_build_object(
         'note','P0 backfill — janela parcial S4A ~7d tratada como cumulativa',
         'common',232,'pct_down',0.77,'avg_ratio',0.158,'sum_loss',1298422)
 WHERE id = '43a03d8c-c44f-4035-bd49-5bf8cf656187';

UPDATE public.campaign_playlist_collections
   SET excluded = true, exclusion_reason = 'upload_quarantined:partial_window'
 WHERE upload_id = '43a03d8c-c44f-4035-bd49-5bf8cf656187';

-- 4. Unique index
DROP INDEX IF EXISTS public.uniq_upload_content_hash_active;
CREATE UNIQUE INDEX uniq_upload_content_hash_active
  ON public.label_spreadsheet_uploads(deal_id, content_hash)
  WHERE quarantined_at IS NULL AND content_hash IS NOT NULL;

-- 5. View monotônica
DROP VIEW IF EXISTS public.vw_campaign_playlist_growth CASCADE;
CREATE VIEW public.vw_campaign_playlist_growth AS
WITH valid_collections AS (
  SELECT c.* FROM public.campaign_playlist_collections c
    LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
   WHERE c.excluded = false AND (u.id IS NULL OR u.quarantined_at IS NULL)
),
baseline AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id, plays_7d AS baseline_plays,
         playlist_name_at_capture AS baseline_name, captured_at AS baseline_at
    FROM valid_collections WHERE is_baseline = true
   ORDER BY campaign_id, playlist_id, captured_at DESC, created_at DESC
),
latest_max AS (
  SELECT campaign_id, playlist_id, MAX(plays_7d) AS current_plays,
         MAX(captured_at) AS last_captured_at, MIN(first_seen_at) AS first_seen_at
    FROM valid_collections GROUP BY campaign_id, playlist_id
),
latest_meta AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id, playlist_name_at_capture AS current_name, playlist_url
    FROM valid_collections
   ORDER BY campaign_id, playlist_id, captured_at DESC, created_at DESC
),
all_ids AS (SELECT DISTINCT campaign_id, playlist_id FROM valid_collections),
eco AS (
  SELECT a.campaign_id, mp.spotify_playlist_id AS playlist_id
    FROM public.campaign_eco_allocations a
    JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
   WHERE mp.spotify_playlist_id IS NOT NULL
),
internal_owned AS (
  SELECT DISTINCT mp.spotify_playlist_id AS playlist_id
    FROM public.managed_playlists mp WHERE mp.spotify_playlist_id IS NOT NULL
),
curator_reg AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id, curator_id, status, excluded_from_kpis
    FROM public.curator_campaign_playlists
   ORDER BY campaign_id, playlist_id,
            CASE status WHEN 'matched' THEN 1 WHEN 'pending_match' THEN 2 WHEN 'baseline_conflict' THEN 3 ELSE 4 END
)
SELECT ai.campaign_id, ai.playlist_id, lm.playlist_url, lm.current_name,
       b.baseline_name, b.baseline_plays, lx.current_plays,
       GREATEST(0, COALESCE(lx.current_plays,0) - COALESCE(b.baseline_plays,0)) AS delta,
       b.baseline_at, lx.last_captured_at, lx.first_seen_at,
       CASE WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'
            WHEN io.playlist_id IS NOT NULL THEN 'organic'
            WHEN cr.curator_id IS NOT NULL AND COALESCE(cr.excluded_from_kpis,false)=false THEN 'curator:'||cr.curator_id::text
            WHEN cr.curator_id IS NOT NULL AND cr.status='baseline_conflict' THEN 'curator:'||cr.curator_id::text
            ELSE 'organic' END AS attributed_to,
       CASE WHEN eco.playlist_id IS NOT NULL OR io.playlist_id IS NOT NULL THEN NULL ELSE cr.curator_id END AS attributed_curator_id,
       CASE WHEN eco.playlist_id IS NOT NULL OR io.playlist_id IS NOT NULL THEN false ELSE (cr.status='baseline_conflict') END AS is_baseline_conflict,
       CASE WHEN eco.playlist_id IS NOT NULL THEN false
            WHEN io.playlist_id IS NOT NULL THEN true
            ELSE COALESCE(cr.excluded_from_kpis,false) END AS excluded_from_kpis
  FROM all_ids ai
  LEFT JOIN baseline b ON b.campaign_id = ai.campaign_id AND b.playlist_id = ai.playlist_id
  LEFT JOIN latest_max lx ON lx.campaign_id = ai.campaign_id AND lx.playlist_id = ai.playlist_id
  LEFT JOIN latest_meta lm ON lm.campaign_id = ai.campaign_id AND lm.playlist_id = ai.playlist_id
  LEFT JOIN eco ON eco.campaign_id = ai.campaign_id AND eco.playlist_id = ai.playlist_id
  LEFT JOIN internal_owned io ON io.playlist_id = ai.playlist_id
  LEFT JOIN curator_reg cr ON cr.campaign_id = ai.campaign_id AND cr.playlist_id = ai.playlist_id;

GRANT SELECT ON public.vw_campaign_playlist_growth TO authenticated, anon, service_role;

-- 6. Função de quarentena
CREATE OR REPLACE FUNCTION public.evaluate_upload_quarantine(
  p_deal_id uuid, p_content_hash text, p_rows jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_last_upload uuid; v_common int := 0; v_regressed int := 0;
  v_avg_ratio numeric := 1; v_pct_down numeric := 0; v_sum_loss bigint := 0;
  v_last_total bigint := 0; v_new_total bigint := 0; v_dup_id uuid;
  v_decision text; v_reason text; v_mode text; v_window text;
BEGIN
  IF p_content_hash IS NOT NULL THEN
    SELECT id INTO v_dup_id FROM label_spreadsheet_uploads
     WHERE deal_id=p_deal_id AND content_hash=p_content_hash AND quarantined_at IS NULL LIMIT 1;
    IF v_dup_id IS NOT NULL THEN
      RETURN jsonb_build_object('decision','reject','reason','duplicate_content','duplicate_of',v_dup_id);
    END IF;
  END IF;

  SELECT id INTO v_last_upload FROM label_spreadsheet_uploads
   WHERE deal_id=p_deal_id AND quarantined_at IS NULL AND status='imported'
   ORDER BY created_at DESC LIMIT 1;

  IF v_last_upload IS NULL THEN
    RETURN jsonb_build_object('decision','accept','mode','baseline','reason','first_upload');
  END IF;

  v_new_total := COALESCE((SELECT SUM((x->>'streams')::bigint) FROM jsonb_array_elements(p_rows) x), 0);

  WITH last_rows AS (
    SELECT playlist_spotify_id, MAX(streams)::bigint AS streams FROM label_spreadsheet_rows
     WHERE upload_id=v_last_upload AND playlist_spotify_id IS NOT NULL GROUP BY playlist_spotify_id
  ),
  new_rows AS (
    SELECT x->>'playlist_spotify_id' AS pid, (x->>'streams')::bigint AS streams
      FROM jsonb_array_elements(p_rows) x WHERE x->>'playlist_spotify_id' IS NOT NULL
  ),
  joined AS (
    SELECT l.streams AS old_s, n.streams AS new_s FROM last_rows l
      JOIN new_rows n ON n.pid=l.playlist_spotify_id WHERE l.streams > 0
  )
  SELECT COUNT(*), COUNT(*) FILTER (WHERE new_s < old_s),
         COALESCE(AVG(new_s::numeric/NULLIF(old_s,0)),1),
         COALESCE(SUM(GREATEST(0, old_s - new_s)),0), COALESCE(SUM(old_s),0)
    INTO v_common, v_regressed, v_avg_ratio, v_sum_loss, v_last_total FROM joined;

  IF v_common > 0 THEN v_pct_down := v_regressed::numeric / v_common; END IF;

  IF v_common < 5 THEN
    RETURN jsonb_build_object('decision','accept','mode','periodic','reason','insufficient_overlap',
      'signals', jsonb_build_object('common',v_common));
  END IF;

  IF v_avg_ratio < 0.05 THEN
    v_decision:='quarantine'; v_reason:='corrupted_or_24h_window'; v_mode:='partial_window'; v_window:='last_24h';
  ELSIF v_avg_ratio < 0.30 THEN
    v_decision:='quarantine'; v_reason:='partial_window_detected'; v_mode:='partial_window'; v_window:='last_7d';
  ELSIF v_avg_ratio < 0.50 OR v_pct_down > 0.50 THEN
    v_decision:='quarantine'; v_reason:='massive_regression'; v_mode:='partial_window'; v_window:='unknown';
  ELSIF v_sum_loss > (v_last_total * 0.30) THEN
    v_decision:='review'; v_reason:='large_loss_review'; v_mode:='periodic'; v_window:=NULL;
  ELSE
    v_decision:='accept'; v_reason:='ok'; v_mode:='periodic'; v_window:='all_time';
  END IF;

  RETURN jsonb_build_object('decision',v_decision,'reason',v_reason,'mode',v_mode,'window_kind',v_window,
    'signals', jsonb_build_object('common',v_common,'regressed',v_regressed,'pct_down',round(v_pct_down,3),
      'avg_ratio',round(v_avg_ratio,3),'sum_loss',v_sum_loss,'last_total',v_last_total,
      'new_total',v_new_total,'last_upload',v_last_upload));
END; $$;

GRANT EXECUTE ON FUNCTION public.evaluate_upload_quarantine(uuid, text, jsonb) TO service_role, authenticated;
