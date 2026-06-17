
-- 1) Coluna de auditoria do supersede
ALTER TABLE public.label_spreadsheet_uploads
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

-- 2) Limpeza dos duplicados existentes — mantém o mais recente, marca os demais
WITH ranked AS (
  SELECT
    id, deal_id, reference_date,
    ROW_NUMBER() OVER (PARTITION BY deal_id, reference_date ORDER BY created_at DESC, id DESC) AS rn,
    FIRST_VALUE(id) OVER (PARTITION BY deal_id, reference_date ORDER BY created_at DESC, id DESC) AS winner_id
  FROM public.label_spreadsheet_uploads
  WHERE status = 'imported' AND quarantined_at IS NULL
)
UPDATE public.label_spreadsheet_uploads u
   SET status = 'superseded',
       superseded_at = COALESCE(u.superseded_at, NOW()),
       superseded_by = r.winner_id
  FROM ranked r
 WHERE u.id = r.id
   AND r.rn > 1;

-- 3) Blindagem estrutural: 1 upload ativo por (deal, reference_date)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lsu_active_per_day
  ON public.label_spreadsheet_uploads (deal_id, reference_date)
  WHERE status = 'imported' AND quarantined_at IS NULL;

-- 4) Trigger BEFORE INSERT que auto-supersedeia o upload ativo do mesmo dia
CREATE OR REPLACE FUNCTION public.tg_lsu_supersede_same_day()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'imported' AND NEW.quarantined_at IS NULL THEN
    UPDATE public.label_spreadsheet_uploads
       SET status = 'superseded',
           superseded_at = NOW(),
           superseded_by = NEW.id
     WHERE deal_id = NEW.deal_id
       AND reference_date = NEW.reference_date
       AND id <> NEW.id
       AND status = 'imported'
       AND quarantined_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lsu_supersede_same_day ON public.label_spreadsheet_uploads;
CREATE TRIGGER trg_lsu_supersede_same_day
BEFORE INSERT ON public.label_spreadsheet_uploads
FOR EACH ROW EXECUTE FUNCTION public.tg_lsu_supersede_same_day();

-- 5) Engine: filtra superseded + ordena delta por reference_date
CREATE OR REPLACE FUNCTION public.fn_playlist_delivery_accumulated(p_campaign_id uuid)
RETURNS TABLE(playlist_id text, delivery_accumulated bigint, current_reading bigint, last_reading_at timestamp with time zone, readings_count integer, last_import_delta bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH canon AS MATERIALIZED (
    SELECT canonical_window_days FROM public.campaigns WHERE id = p_campaign_id
  ),
  allowed AS MATERIALIZED (
    SELECT ccp.playlist_id FROM public.curator_campaign_playlists ccp
     WHERE ccp.campaign_id = p_campaign_id
       AND COALESCE(ccp.excluded_from_kpis, false) = false
    UNION
    SELECT mp.spotify_playlist_id
      FROM public.campaign_eco_allocations a
      JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
     WHERE a.campaign_id = p_campaign_id
       AND mp.spotify_playlist_id IS NOT NULL
    UNION
    SELECT cpc.playlist_id
      FROM public.campaign_playlist_collections cpc
     WHERE cpc.campaign_id = p_campaign_id
       AND cpc.is_baseline = true
       AND COALESCE(cpc.excluded, false) = false
       AND cpc.playlist_id IS NOT NULL
  ),
  valid AS MATERIALIZED (
    SELECT c.playlist_id, c.plays_7d, c.is_baseline, c.captured_at,
           COALESCE(u.created_at, c.created_at) AS up_created,
           -- Eixo temporal canônico: dia de referência do upload (ou do snapshot quando não há upload).
           COALESCE(u.reference_date, (c.captured_at AT TIME ZONE 'UTC')::date) AS up_ref_date,
           COALESCE(u.window_kind,
             CASE WHEN c.upload_id IS NULL THEN 'last_7d' ELSE 'unknown' END
           ) AS window_kind
      FROM public.campaign_playlist_collections c
      LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
     WHERE c.campaign_id = p_campaign_id
       AND COALESCE(c.excluded, false) = false
       -- Exclui uploads em quarentena OU superseded.
       AND (u.id IS NULL OR (u.quarantined_at IS NULL AND COALESCE(u.status, 'imported') <> 'superseded'))
       AND c.window_days = (SELECT canonical_window_days FROM canon)
       AND (c.is_baseline = true OR c.playlist_id IN (SELECT a2.playlist_id FROM allowed a2))
  ),
  has_baseline AS MATERIALIZED (
    SELECT v.playlist_id, BOOL_OR(v.is_baseline) AS has_bl
      FROM valid v GROUP BY v.playlist_id
  ),
  ordered AS MATERIALIZED (
    SELECT v.playlist_id, v.plays_7d, v.captured_at, v.window_kind, hb.has_bl,
           -- Ordena por data de referência (reference_date); created_at só desempata dentro do mesmo dia.
           ROW_NUMBER() OVER (PARTITION BY v.playlist_id ORDER BY v.up_ref_date, v.up_created, v.captured_at) AS rn,
           LAG(v.plays_7d) OVER (PARTITION BY v.playlist_id ORDER BY v.up_ref_date, v.up_created, v.captured_at) AS prev_plays
      FROM valid v
      JOIN has_baseline hb USING (playlist_id)
  ),
  with_delta AS MATERIALIZED (
    SELECT o.playlist_id, o.plays_7d, o.captured_at, o.rn, o.prev_plays, o.has_bl, o.window_kind,
           CASE
             WHEN o.window_kind IN ('last_24h','last_day')
               THEN o.plays_7d::bigint
             WHEN o.rn = 1 AND o.has_bl     THEN 0::bigint
             WHEN o.rn = 1 AND NOT o.has_bl THEN o.plays_7d::bigint
             ELSE GREATEST(0, o.plays_7d - COALESCE(o.prev_plays, o.plays_7d))::bigint
           END AS delta_pos
      FROM ordered o
  ),
  totals AS MATERIALIZED (
    SELECT w.playlist_id,
           SUM(w.delta_pos)::bigint AS delivery_accumulated,
           MAX(w.plays_7d)::bigint  AS current_reading,
           MAX(w.captured_at)       AS last_reading_at,
           COUNT(*)::int            AS readings_count,
           MAX(w.rn)                AS max_rn
      FROM with_delta w GROUP BY w.playlist_id
  ),
  last_row AS MATERIALIZED (
    SELECT w.playlist_id,
           CASE
             WHEN w.window_kind IN ('last_24h','last_day')
               THEN w.plays_7d::bigint
             WHEN w.rn = 1 AND NOT w.has_bl THEN w.plays_7d::bigint
             WHEN w.prev_plays IS NULL      THEN NULL
             ELSE GREATEST(0, w.plays_7d - w.prev_plays)::bigint
           END AS last_import_delta
      FROM with_delta w
      JOIN totals t ON t.playlist_id = w.playlist_id AND t.max_rn = w.rn
  )
  SELECT t.playlist_id,
         t.delivery_accumulated,
         t.current_reading,
         t.last_reading_at,
         t.readings_count,
         lr.last_import_delta
    FROM totals t
    LEFT JOIN last_row lr ON lr.playlist_id = t.playlist_id;
END;
$function$;

-- 6) Views derivadas: filtrar superseded também
CREATE OR REPLACE VIEW public.vw_campaign_playlist_growth AS
WITH valid_collections AS (
  SELECT c.id, c.campaign_id, c.playlist_id, c.playlist_url,
         c.playlist_name_at_capture, c.plays_7d, c.captured_at, c.is_baseline,
         c.first_seen_at, c.source, c.proof_screenshot_url, c.created_at,
         c.collection_run_id, c.proof_screenshot_urls, c.snapshot_run_id,
         c.upload_id, c.excluded, c.exclusion_reason
    FROM public.campaign_playlist_collections c
    LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
   WHERE COALESCE(c.excluded, false) = false
     AND (u.id IS NULL OR (u.quarantined_at IS NULL AND COALESCE(u.status,'imported') <> 'superseded'))
), baseline AS (
  SELECT DISTINCT ON (campaign_id, playlist_id) campaign_id, playlist_id,
         plays_7d AS baseline_plays, playlist_name_at_capture AS baseline_name,
         captured_at AS baseline_at
    FROM valid_collections WHERE is_baseline = true
   ORDER BY campaign_id, playlist_id, captured_at DESC, created_at DESC
), latest_meta AS (
  SELECT DISTINCT ON (campaign_id, playlist_id) campaign_id, playlist_id,
         playlist_name_at_capture AS current_name, playlist_url,
         plays_7d AS latest_plays, captured_at AS last_captured_at
    FROM valid_collections
   ORDER BY campaign_id, playlist_id, captured_at DESC, created_at DESC
), campaigns_with_data AS (
  SELECT DISTINCT campaign_id FROM valid_collections
), all_ids AS (
  SELECT DISTINCT campaign_id, playlist_id FROM valid_collections
), acc AS (
  SELECT c.campaign_id, f.playlist_id, f.delivery_accumulated, f.current_reading,
         f.last_reading_at, f.readings_count, f.last_import_delta
    FROM campaigns_with_data c
    CROSS JOIN LATERAL public.fn_playlist_delivery_accumulated(c.campaign_id) f
), firsts AS (
  SELECT campaign_id, playlist_id, MIN(first_seen_at) AS first_seen_at
    FROM valid_collections GROUP BY campaign_id, playlist_id
), eco AS (
  SELECT a.campaign_id, mp.spotify_playlist_id AS playlist_id
    FROM public.campaign_eco_allocations a
    JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
   WHERE mp.spotify_playlist_id IS NOT NULL
), internal_owned AS (
  SELECT DISTINCT mp.spotify_playlist_id AS playlist_id
    FROM public.managed_playlists mp WHERE mp.spotify_playlist_id IS NOT NULL
), curator_reg AS (
  SELECT DISTINCT ON (campaign_id, playlist_id) campaign_id, playlist_id, curator_id, status, excluded_from_kpis
    FROM public.curator_campaign_playlists
   ORDER BY campaign_id, playlist_id,
     (CASE status WHEN 'matched' THEN 1 WHEN 'pending_match' THEN 2 WHEN 'baseline_conflict' THEN 3 ELSE 4 END)
)
SELECT ai.campaign_id, ai.playlist_id, lm.playlist_url, lm.current_name,
       b.baseline_name, b.baseline_plays, lm.latest_plays AS current_plays,
       COALESCE(acc.delivery_accumulated, 0::bigint) AS delivery_accumulated,
       COALESCE(acc.delivery_accumulated, 0::bigint) AS delta,
       acc.last_import_delta, b.baseline_at, lm.last_captured_at, fr.first_seen_at,
       CASE
         WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'::text
         WHEN io.playlist_id IS NOT NULL THEN 'organic'::text
         WHEN cr.curator_id IS NOT NULL AND COALESCE(cr.excluded_from_kpis,false)=false THEN 'curator:'||cr.curator_id::text
         WHEN cr.curator_id IS NOT NULL AND cr.status='baseline_conflict' THEN 'curator:'||cr.curator_id::text
         ELSE 'organic'::text
       END AS attributed_to
  FROM all_ids ai
  LEFT JOIN baseline b ON b.campaign_id=ai.campaign_id AND b.playlist_id=ai.playlist_id
  LEFT JOIN latest_meta lm ON lm.campaign_id=ai.campaign_id AND lm.playlist_id=ai.playlist_id
  LEFT JOIN acc ON acc.campaign_id=ai.campaign_id AND acc.playlist_id=ai.playlist_id
  LEFT JOIN firsts fr ON fr.campaign_id=ai.campaign_id AND fr.playlist_id=ai.playlist_id
  LEFT JOIN eco ON eco.campaign_id=ai.campaign_id AND eco.playlist_id=ai.playlist_id
  LEFT JOIN internal_owned io ON io.playlist_id=ai.playlist_id
  LEFT JOIN curator_reg cr ON cr.campaign_id=ai.campaign_id AND cr.playlist_id=ai.playlist_id;

CREATE OR REPLACE VIEW public.vw_campaign_playlist_delivery_origin AS
WITH canon AS (
  SELECT id AS campaign_id, canonical_window_days FROM public.campaigns
), valid AS (
  SELECT c.campaign_id, c.playlist_id, c.is_baseline
    FROM public.campaign_playlist_collections c
    JOIN canon ON canon.campaign_id = c.campaign_id
    LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
   WHERE COALESCE(c.excluded,false)=false
     AND (u.id IS NULL OR (u.quarantined_at IS NULL AND COALESCE(u.status,'imported') <> 'superseded'))
     AND c.window_days = canon.canonical_window_days
), origin AS (
  SELECT campaign_id, playlist_id, BOOL_OR(is_baseline) AS has_real_baseline
    FROM valid GROUP BY campaign_id, playlist_id
)
SELECT g.campaign_id, g.playlist_id, g.current_name, g.delivery_accumulated, g.attributed_to,
       COALESCE(o.has_real_baseline,false) AS has_real_baseline,
       CASE WHEN COALESCE(o.has_real_baseline,false) THEN 'baseline_original' ELSE 'post_baseline' END AS delivery_origin
  FROM public.vw_campaign_playlist_growth g
  LEFT JOIN origin o ON o.campaign_id=g.campaign_id AND o.playlist_id=g.playlist_id;

-- 7) Função SQL get_campaign_playlist_growth: mesmo filtro
CREATE OR REPLACE FUNCTION public.get_campaign_playlist_growth(p_campaign_id uuid)
RETURNS TABLE(campaign_id uuid, playlist_id text, playlist_url text, current_name text, baseline_name text, baseline_plays integer, current_plays integer, delivery_accumulated bigint, delta bigint, last_import_delta bigint, baseline_at timestamp with time zone, last_captured_at timestamp with time zone, first_seen_at timestamp with time zone, attributed_to text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH valid_collections AS (
    SELECT c.id, c.campaign_id, c.playlist_id, c.playlist_url,
           c.playlist_name_at_capture, c.plays_7d, c.captured_at, c.is_baseline,
           c.first_seen_at, c.created_at, c.upload_id, c.excluded
    FROM public.campaign_playlist_collections c
    LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
    WHERE c.campaign_id = p_campaign_id
      AND COALESCE(c.excluded,false)=false
      AND (u.id IS NULL OR (u.quarantined_at IS NULL AND COALESCE(u.status,'imported') <> 'superseded'))
  ),
  baseline AS (
    SELECT DISTINCT ON (playlist_id) playlist_id, plays_7d AS baseline_plays,
           playlist_name_at_capture AS baseline_name, captured_at AS baseline_at
    FROM valid_collections WHERE is_baseline=true
    ORDER BY playlist_id, captured_at DESC, created_at DESC
  ),
  latest_meta AS (
    SELECT DISTINCT ON (playlist_id) playlist_id, playlist_name_at_capture AS current_name,
           playlist_url, plays_7d AS latest_plays, captured_at AS last_captured_at
    FROM valid_collections
    ORDER BY playlist_id, captured_at DESC, created_at DESC
  ),
  all_ids AS (SELECT DISTINCT playlist_id FROM valid_collections),
  acc AS (
    SELECT f.playlist_id, f.delivery_accumulated, f.current_reading,
           f.last_reading_at, f.readings_count, f.last_import_delta
    FROM public.fn_playlist_delivery_accumulated(p_campaign_id) f
  ),
  firsts AS (
    SELECT playlist_id, MIN(first_seen_at) AS first_seen_at
    FROM valid_collections GROUP BY playlist_id
  ),
  eco AS (
    SELECT mp.spotify_playlist_id AS playlist_id
    FROM public.campaign_eco_allocations a
    JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
    WHERE a.campaign_id = p_campaign_id AND mp.spotify_playlist_id IS NOT NULL
  ),
  internal_owned AS (
    SELECT DISTINCT mp.spotify_playlist_id AS playlist_id
    FROM public.managed_playlists mp WHERE mp.spotify_playlist_id IS NOT NULL
  ),
  curator_reg AS (
    SELECT DISTINCT ON (playlist_id) playlist_id, curator_id, status, excluded_from_kpis
    FROM public.curator_campaign_playlists
    WHERE campaign_id = p_campaign_id
    ORDER BY playlist_id,
      (CASE status WHEN 'matched' THEN 1 WHEN 'pending_match' THEN 2 WHEN 'baseline_conflict' THEN 3 ELSE 4 END)
  )
  SELECT p_campaign_id AS campaign_id, ai.playlist_id, lm.playlist_url, lm.current_name,
         b.baseline_name, b.baseline_plays::int, lm.latest_plays::int AS current_plays,
         COALESCE(acc.delivery_accumulated, 0::bigint) AS delivery_accumulated,
         COALESCE(acc.delivery_accumulated, 0::bigint) AS delta,
         acc.last_import_delta, b.baseline_at, lm.last_captured_at, fr.first_seen_at,
         CASE
           WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'
           WHEN io.playlist_id IS NOT NULL THEN 'organic'
           WHEN cr.curator_id IS NOT NULL AND COALESCE(cr.excluded_from_kpis,false)=false THEN 'curator:'||cr.curator_id::text
           WHEN cr.curator_id IS NOT NULL AND cr.status='baseline_conflict' THEN 'curator:'||cr.curator_id::text
           ELSE 'organic'
         END AS attributed_to
    FROM all_ids ai
    LEFT JOIN baseline b ON b.playlist_id=ai.playlist_id
    LEFT JOIN latest_meta lm ON lm.playlist_id=ai.playlist_id
    LEFT JOIN acc ON acc.playlist_id=ai.playlist_id
    LEFT JOIN firsts fr ON fr.playlist_id=ai.playlist_id
    LEFT JOIN eco ON eco.playlist_id=ai.playlist_id
    LEFT JOIN internal_owned io ON io.playlist_id=ai.playlist_id
    LEFT JOIN curator_reg cr ON cr.playlist_id=ai.playlist_id;
$function$;

-- 8) Recalcula total entregue da campanha afetada (Carnívoro)
SELECT public.recompute_campaign_total_delivered('0170d78a-97f1-41f7-99eb-a5b31c367053'::uuid);
