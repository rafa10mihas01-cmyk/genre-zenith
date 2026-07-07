
-- ============================================================================
-- FIX 1: fn_playlist_delivery_accumulated
--   (a) considera paste automático do curador como leitura válida
--   (b) injeta uma leitura ZERO no marco zero da baseline para playlists que
--       NÃO estão na baseline oficial (is_baseline=true) — assim a primeira
--       leitura real dessas playlists conta INTEGRALMENTE como entrega.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_playlist_delivery_accumulated(p_campaign_id uuid)
 RETURNS TABLE(playlist_id text, delivery_accumulated bigint, current_reading bigint, last_reading_at timestamp with time zone, readings_count integer, last_import_delta bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH canon AS MATERIALIZED (
    SELECT canonical_window_days, baseline_captured_at
      FROM public.campaigns
     WHERE id = p_campaign_id
  ),
  allowed AS MATERIALIZED (
    SELECT ccp.playlist_id
      FROM public.curator_campaign_playlists ccp
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
       AND COALESCE(cpc.excluded, false) = false
       AND cpc.playlist_id IS NOT NULL
    UNION
    SELECT cp.spotify_playlist_id
      FROM public.curator_playlists cp
      JOIN public.curator_deals cd ON cd.id = cp.deal_id
     WHERE cd.campaign_id = p_campaign_id
       AND cp.spotify_playlist_id IS NOT NULL
       AND COALESCE(cp.is_observational,false)=false
       AND cp.spotify_dead_at IS NULL
  ),
  baseline_ids AS MATERIALIZED (
    SELECT DISTINCT cpc.playlist_id
      FROM public.campaign_playlist_collections cpc
     WHERE cpc.campaign_id = p_campaign_id
       AND cpc.is_baseline = true
       AND cpc.playlist_id IS NOT NULL
  ),
  xlsx_readings AS (
    SELECT c.playlist_id,
           c.plays_7d,
           c.captured_at,
           c.upload_id,
           COALESCE(u.created_at, c.created_at, c.captured_at) AS sequence_at,
           COALESCE(
             u.window_kind,
             CASE WHEN c.upload_id IS NULL THEN 'last_7d' ELSE 'unknown' END
           ) AS window_kind
      FROM public.campaign_playlist_collections c
      LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
     WHERE c.campaign_id = p_campaign_id
       AND COALESCE(c.excluded, false) = false
       AND (u.id IS NULL OR u.quarantined_at IS NULL)
       AND c.window_days = (SELECT canonical_window_days FROM canon)
  ),
  paste_readings AS (
    SELECT cp.spotify_playlist_id       AS playlist_id,
           COALESCE(cp.streams_7d,0)    AS plays_7d,
           cp.last_paste_at             AS captured_at,
           NULL::uuid                   AS upload_id,
           cp.last_paste_at             AS sequence_at,
           'last_7d'::text              AS window_kind
      FROM public.curator_playlists cp
      JOIN public.curator_deals cd ON cd.id = cp.deal_id
     WHERE cd.campaign_id = p_campaign_id
       AND cp.spotify_playlist_id IS NOT NULL
       AND cp.last_paste_at IS NOT NULL
       AND COALESCE(cp.is_observational,false)=false
       AND cp.spotify_dead_at IS NULL
  ),
  -- Leitura sintética "zero" no marco zero, só pra playlists NÃO baseline.
  -- Garante que a primeira leitura real dessas playlists conte inteira.
  zero_seed AS (
    SELECT DISTINCT
           a.playlist_id,
           0::int                                  AS plays_7d,
           (SELECT baseline_captured_at FROM canon) AS captured_at,
           NULL::uuid                              AS upload_id,
           (SELECT baseline_captured_at FROM canon) AS sequence_at,
           'last_7d'::text                         AS window_kind
      FROM allowed a
     WHERE (SELECT baseline_captured_at FROM canon) IS NOT NULL
       AND a.playlist_id NOT IN (SELECT playlist_id FROM baseline_ids)
  ),
  all_readings AS (
    SELECT * FROM xlsx_readings
    UNION ALL SELECT * FROM paste_readings
    UNION ALL SELECT * FROM zero_seed
  ),
  valid AS MATERIALIZED (
    SELECT r.*
      FROM all_readings r
     WHERE r.playlist_id IN (SELECT a2.playlist_id FROM allowed a2)
  ),
  ordered AS MATERIALIZED (
    SELECT v.playlist_id, v.plays_7d, v.captured_at, v.upload_id, v.window_kind,
           ROW_NUMBER() OVER (PARTITION BY v.playlist_id ORDER BY v.sequence_at, v.captured_at, v.upload_id NULLS FIRST) AS rn,
           LAG(v.plays_7d) OVER (PARTITION BY v.playlist_id ORDER BY v.sequence_at, v.captured_at, v.upload_id NULLS FIRST) AS prev_plays
      FROM valid v
  ),
  with_delta AS MATERIALIZED (
    SELECT o.playlist_id, o.plays_7d, o.captured_at, o.upload_id, o.rn, o.prev_plays, o.window_kind,
           CASE
             WHEN o.rn = 1 THEN 0::bigint
             WHEN o.window_kind IN ('last_24h','last_day') THEN o.plays_7d::bigint
             ELSE GREATEST(0, o.plays_7d - COALESCE(o.prev_plays, o.plays_7d))::bigint
           END AS delta_pos
      FROM ordered o
  ),
  totals AS MATERIALIZED (
    SELECT w.playlist_id, SUM(w.delta_pos)::bigint AS delivery_accumulated,
           COUNT(*)::int AS readings_count, MAX(w.rn) AS max_rn
      FROM with_delta w GROUP BY w.playlist_id
  ),
  last_row AS MATERIALIZED (
    SELECT w.playlist_id, w.plays_7d::bigint AS current_reading, w.captured_at AS last_reading_at,
           CASE
             WHEN w.rn = 1 THEN 0::bigint
             WHEN w.window_kind IN ('last_24h','last_day') THEN w.plays_7d::bigint
             WHEN w.prev_plays IS NULL THEN NULL
             ELSE GREATEST(0, w.plays_7d - w.prev_plays)::bigint
           END AS last_import_delta
      FROM with_delta w
      JOIN totals t ON t.playlist_id = w.playlist_id AND t.max_rn = w.rn
  )
  SELECT t.playlist_id, t.delivery_accumulated, lr.current_reading, lr.last_reading_at, t.readings_count, lr.last_import_delta
    FROM totals t
    LEFT JOIN last_row lr ON lr.playlist_id = t.playlist_id;
END;
$function$;

-- ============================================================================
-- FIX 2: fn_campaign_playlist_growth
--   Regra de baseline: se a playlist NÃO está na baseline oficial da campanha,
--   baseline_plays=0 e baseline_at=campaigns.baseline_captured_at.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_campaign_playlist_growth(p_campaign_ids uuid[])
 RETURNS TABLE(campaign_id uuid, playlist_id text, playlist_url text, current_name text, baseline_name text, baseline_plays bigint, current_plays bigint, delivery_accumulated bigint, delta bigint, last_import_delta bigint, baseline_at timestamp with time zone, last_captured_at timestamp with time zone, first_seen_at timestamp with time zone, attributed_to text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH xlsx_collections AS (
    SELECT c.campaign_id, c.playlist_id, c.playlist_url, c.playlist_name_at_capture,
           c.plays_7d, c.captured_at, c.first_seen_at, c.created_at, c.upload_id,
           COALESCE(u.created_at, c.created_at, c.captured_at) AS sequence_at,
           'xlsx'::text AS source
    FROM public.campaign_playlist_collections c
    LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
    WHERE c.campaign_id = ANY(p_campaign_ids)
      AND COALESCE(c.excluded,false)=false
      AND (u.id IS NULL OR u.quarantined_at IS NULL)
  ),
  paste_collections AS (
    SELECT DISTINCT ON (cd.campaign_id, cp.spotify_playlist_id, cp.last_paste_at)
      cd.campaign_id, cp.spotify_playlist_id AS playlist_id, cp.spotify_url AS playlist_url,
      cp.playlist_name AS playlist_name_at_capture,
      COALESCE(cp.streams_7d,0)::bigint AS plays_7d,
      cp.last_paste_at AS captured_at, cp.last_paste_at AS first_seen_at,
      cp.last_paste_at AS created_at, NULL::uuid AS upload_id,
      cp.last_paste_at AS sequence_at, 'paste'::text AS source
    FROM public.curator_playlists cp
    JOIN public.curator_deals cd ON cd.id = cp.deal_id
    WHERE cd.campaign_id = ANY(p_campaign_ids)
      AND cp.spotify_playlist_id IS NOT NULL
      AND cp.last_paste_at IS NOT NULL
      AND COALESCE(cp.is_observational,false)=false
      AND cp.spotify_dead_at IS NULL
    ORDER BY cd.campaign_id, cp.spotify_playlist_id, cp.last_paste_at, cp.streams_7d DESC
  ),
  valid_collections AS (
    SELECT * FROM xlsx_collections UNION ALL SELECT * FROM paste_collections
  ),
  ordered AS (
    SELECT vc.*,
      ROW_NUMBER() OVER (PARTITION BY vc.campaign_id, vc.playlist_id ORDER BY vc.sequence_at, vc.captured_at, vc.upload_id NULLS FIRST) AS seq_rn
    FROM valid_collections vc
  ),
  baseline_ids AS (
    SELECT DISTINCT cpc.campaign_id, cpc.playlist_id
    FROM public.campaign_playlist_collections cpc
    WHERE cpc.campaign_id = ANY(p_campaign_ids)
      AND cpc.is_baseline = true
      AND cpc.playlist_id IS NOT NULL
  ),
  baseline_official AS (
    SELECT DISTINCT ON (cpc.campaign_id, cpc.playlist_id)
      cpc.campaign_id, cpc.playlist_id,
      cpc.plays_7d AS baseline_plays,
      cpc.playlist_name_at_capture AS baseline_name,
      cpc.captured_at AS baseline_at
    FROM public.campaign_playlist_collections cpc
    WHERE cpc.campaign_id = ANY(p_campaign_ids)
      AND cpc.is_baseline = true
    ORDER BY cpc.campaign_id, cpc.playlist_id, cpc.captured_at
  ),
  campaign_baseline_ts AS (
    SELECT id AS campaign_id, baseline_captured_at
    FROM public.campaigns
    WHERE id = ANY(p_campaign_ids)
  ),
  latest_meta AS (
    SELECT DISTINCT ON (vc.campaign_id, vc.playlist_id)
      vc.campaign_id, vc.playlist_id, vc.playlist_name_at_capture AS current_name,
      vc.playlist_url, vc.plays_7d AS latest_plays, vc.captured_at AS last_captured_at
    FROM valid_collections vc
    ORDER BY vc.campaign_id, vc.playlist_id, vc.sequence_at DESC, vc.captured_at DESC, vc.created_at DESC
  ),
  all_ids AS (SELECT DISTINCT vc.campaign_id, vc.playlist_id FROM valid_collections vc),
  campaigns_with_data AS (SELECT DISTINCT vc.campaign_id FROM valid_collections vc),
  acc AS (
    SELECT c.campaign_id, f.playlist_id, f.delivery_accumulated, f.current_reading,
           f.last_reading_at, f.readings_count, f.last_import_delta
    FROM campaigns_with_data c
    CROSS JOIN LATERAL public.fn_playlist_delivery_accumulated(c.campaign_id) f
  ),
  firsts AS (
    SELECT vc.campaign_id, vc.playlist_id, min(vc.first_seen_at) AS first_seen_at
    FROM valid_collections vc GROUP BY vc.campaign_id, vc.playlist_id
  ),
  eco AS (
    SELECT a.campaign_id, mp.spotify_playlist_id AS playlist_id
    FROM public.campaign_eco_allocations a
    JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
    WHERE a.campaign_id = ANY(p_campaign_ids) AND mp.spotify_playlist_id IS NOT NULL
  ),
  internal_owned AS (
    SELECT DISTINCT mp.spotify_playlist_id AS playlist_id
    FROM public.managed_playlists mp WHERE mp.spotify_playlist_id IS NOT NULL
  ),
  curator_reg AS (
    SELECT DISTINCT ON (ccp.campaign_id, ccp.playlist_id)
      ccp.campaign_id, ccp.playlist_id, ccp.curator_id, ccp.status, ccp.excluded_from_kpis
    FROM public.curator_campaign_playlists ccp
    WHERE ccp.campaign_id = ANY(p_campaign_ids)
    ORDER BY ccp.campaign_id, ccp.playlist_id,
      (CASE ccp.status WHEN 'matched' THEN 1 WHEN 'pending_match' THEN 2 WHEN 'baseline_conflict' THEN 3 ELSE 4 END)
  )
  SELECT
    ai.campaign_id, ai.playlist_id, lm.playlist_url, lm.current_name,
    COALESCE(bo.baseline_name, lm.current_name)         AS baseline_name,
    COALESCE(bo.baseline_plays, 0)::bigint              AS baseline_plays,
    lm.latest_plays                                     AS current_plays,
    COALESCE(acc.delivery_accumulated, 0::bigint)       AS delivery_accumulated,
    COALESCE(acc.delivery_accumulated, 0::bigint)       AS delta,
    acc.last_import_delta,
    COALESCE(bo.baseline_at, cbt.baseline_captured_at)  AS baseline_at,
    lm.last_captured_at, fr.first_seen_at,
    CASE
      WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'
      WHEN io.playlist_id IS NOT NULL THEN 'organic'
      WHEN cr.curator_id IS NOT NULL AND COALESCE(cr.excluded_from_kpis,false)=false THEN 'curator:'||cr.curator_id::text
      WHEN cr.curator_id IS NOT NULL AND cr.status='baseline_conflict' THEN 'curator:'||cr.curator_id::text
      ELSE 'organic'
    END AS attributed_to
  FROM all_ids ai
  LEFT JOIN baseline_official bo  ON bo.campaign_id=ai.campaign_id AND bo.playlist_id=ai.playlist_id
  LEFT JOIN campaign_baseline_ts cbt ON cbt.campaign_id=ai.campaign_id
  LEFT JOIN latest_meta      lm  ON lm.campaign_id=ai.campaign_id AND lm.playlist_id=ai.playlist_id
  LEFT JOIN acc              acc ON acc.campaign_id=ai.campaign_id AND acc.playlist_id=ai.playlist_id
  LEFT JOIN firsts           fr  ON fr.campaign_id=ai.campaign_id AND fr.playlist_id=ai.playlist_id
  LEFT JOIN eco              eco ON eco.campaign_id=ai.campaign_id AND eco.playlist_id=ai.playlist_id
  LEFT JOIN internal_owned   io  ON io.playlist_id=ai.playlist_id
  LEFT JOIN curator_reg      cr  ON cr.campaign_id=ai.campaign_id AND cr.playlist_id=ai.playlist_id;
$function$;
