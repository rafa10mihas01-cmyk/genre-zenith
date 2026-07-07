
CREATE OR REPLACE FUNCTION public.fn_campaign_playlist_growth(p_campaign_ids uuid[])
 RETURNS TABLE(campaign_id uuid, playlist_id text, playlist_url text, current_name text, baseline_name text, baseline_plays bigint, current_plays bigint, delivery_accumulated bigint, delta bigint, last_import_delta bigint, baseline_at timestamp with time zone, last_captured_at timestamp with time zone, first_seen_at timestamp with time zone, attributed_to text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Fase 14.3 — Unificação de fontes de leitura por playlist:
  --   (A) campaign_playlist_collections (upload XLSX manual da label);
  --   (B) curator_playlists.streams_7d/last_paste_at (paste automático do curador).
  -- As duas medem a mesma janela (plays_7d do S4A) para a mesma playlist. Aqui
  -- unimos as leituras válidas e escolhemos a mais recente por (campanha, playlist).
  -- Baseline continua sendo a leitura MAIS ANTIGA disponível (independente da origem).
  WITH xlsx_collections AS (
    SELECT
      c.campaign_id,
      c.playlist_id,
      c.playlist_url,
      c.playlist_name_at_capture,
      c.plays_7d,
      c.captured_at,
      c.first_seen_at,
      c.created_at,
      c.upload_id,
      COALESCE(u.created_at, c.created_at, c.captured_at) AS sequence_at,
      'xlsx'::text AS source
    FROM public.campaign_playlist_collections c
    LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
    WHERE c.campaign_id = ANY(p_campaign_ids)
      AND COALESCE(c.excluded, false) = false
      AND (u.id IS NULL OR u.quarantined_at IS NULL)
  ),
  paste_collections AS (
    -- Leituras vindas do paste automático do curador. Mapeadas para a campanha
    -- via curator_deals.campaign_id (relação deal↔campanha).
    SELECT
      cd.campaign_id                         AS campaign_id,
      cp.spotify_playlist_id                 AS playlist_id,
      cp.spotify_url                         AS playlist_url,
      cp.playlist_name                       AS playlist_name_at_capture,
      COALESCE(cp.streams_7d, 0)::bigint     AS plays_7d,
      cp.last_paste_at                       AS captured_at,
      cp.last_paste_at                       AS first_seen_at,
      cp.last_paste_at                       AS created_at,
      NULL::uuid                             AS upload_id,
      cp.last_paste_at                       AS sequence_at,
      'paste'::text                          AS source
    FROM public.curator_playlists cp
    JOIN public.curator_deals cd ON cd.id = cp.deal_id
    WHERE cd.campaign_id = ANY(p_campaign_ids)
      AND cp.spotify_playlist_id IS NOT NULL
      AND cp.last_paste_at IS NOT NULL
      AND COALESCE(cp.is_observational, false) = false
      AND cp.spotify_dead_at IS NULL
      AND cp.frozen_at IS NULL
  ),
  valid_collections AS (
    SELECT * FROM xlsx_collections
    UNION ALL
    SELECT * FROM paste_collections
  ),
  ordered AS (
    SELECT
      vc.*,
      ROW_NUMBER() OVER (
        PARTITION BY vc.campaign_id, vc.playlist_id
        ORDER BY vc.sequence_at, vc.captured_at, vc.upload_id NULLS FIRST
      ) AS seq_rn
    FROM valid_collections vc
  ),
  baseline AS (
    SELECT DISTINCT ON (o.campaign_id, o.playlist_id)
      o.campaign_id,
      o.playlist_id,
      o.plays_7d                 AS baseline_plays,
      o.playlist_name_at_capture AS baseline_name,
      o.captured_at              AS baseline_at
    FROM ordered o
    WHERE o.seq_rn = 1
    ORDER BY o.campaign_id, o.playlist_id, o.sequence_at, o.captured_at, o.created_at
  ),
  latest_meta AS (
    SELECT DISTINCT ON (vc.campaign_id, vc.playlist_id)
      vc.campaign_id,
      vc.playlist_id,
      vc.playlist_name_at_capture AS current_name,
      vc.playlist_url,
      vc.plays_7d                 AS latest_plays,
      vc.captured_at              AS last_captured_at
    FROM valid_collections vc
    ORDER BY
      vc.campaign_id, vc.playlist_id,
      vc.sequence_at DESC, vc.captured_at DESC, vc.created_at DESC
  ),
  all_ids AS (
    SELECT DISTINCT vc.campaign_id, vc.playlist_id
    FROM valid_collections vc
  ),
  campaigns_with_data AS (
    SELECT DISTINCT vc.campaign_id
    FROM valid_collections vc
  ),
  acc AS (
    SELECT
      c.campaign_id,
      f.playlist_id,
      f.delivery_accumulated,
      f.current_reading,
      f.last_reading_at,
      f.readings_count,
      f.last_import_delta
    FROM campaigns_with_data c
    CROSS JOIN LATERAL public.fn_playlist_delivery_accumulated(c.campaign_id) f
  ),
  firsts AS (
    SELECT
      vc.campaign_id,
      vc.playlist_id,
      min(vc.first_seen_at) AS first_seen_at
    FROM valid_collections vc
    GROUP BY vc.campaign_id, vc.playlist_id
  ),
  eco AS (
    SELECT
      a.campaign_id,
      mp.spotify_playlist_id AS playlist_id
    FROM public.campaign_eco_allocations a
    JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
    WHERE a.campaign_id = ANY(p_campaign_ids)
      AND mp.spotify_playlist_id IS NOT NULL
  ),
  internal_owned AS (
    SELECT DISTINCT mp.spotify_playlist_id AS playlist_id
    FROM public.managed_playlists mp
    WHERE mp.spotify_playlist_id IS NOT NULL
  ),
  curator_reg AS (
    SELECT DISTINCT ON (ccp.campaign_id, ccp.playlist_id)
      ccp.campaign_id,
      ccp.playlist_id,
      ccp.curator_id,
      ccp.status,
      ccp.excluded_from_kpis
    FROM public.curator_campaign_playlists ccp
    WHERE ccp.campaign_id = ANY(p_campaign_ids)
    ORDER BY
      ccp.campaign_id, ccp.playlist_id,
      (CASE ccp.status
         WHEN 'matched' THEN 1
         WHEN 'pending_match' THEN 2
         WHEN 'baseline_conflict' THEN 3
         ELSE 4
       END)
  )
  SELECT
    ai.campaign_id,
    ai.playlist_id,
    lm.playlist_url,
    lm.current_name,
    b.baseline_name,
    b.baseline_plays,
    lm.latest_plays                               AS current_plays,
    COALESCE(acc.delivery_accumulated, 0::bigint) AS delivery_accumulated,
    COALESCE(acc.delivery_accumulated, 0::bigint) AS delta,
    acc.last_import_delta,
    b.baseline_at,
    lm.last_captured_at,
    fr.first_seen_at,
    CASE
      WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'
      WHEN io.playlist_id IS NOT NULL THEN 'organic'
      WHEN cr.curator_id IS NOT NULL AND COALESCE(cr.excluded_from_kpis, false) = false
        THEN 'curator:' || cr.curator_id::text
      WHEN cr.curator_id IS NOT NULL AND cr.status = 'baseline_conflict'
        THEN 'curator:' || cr.curator_id::text
      ELSE 'organic'
    END AS attributed_to
  FROM all_ids ai
  LEFT JOIN baseline       b   ON b.campaign_id   = ai.campaign_id AND b.playlist_id   = ai.playlist_id
  LEFT JOIN latest_meta    lm  ON lm.campaign_id  = ai.campaign_id AND lm.playlist_id  = ai.playlist_id
  LEFT JOIN acc            acc ON acc.campaign_id = ai.campaign_id AND acc.playlist_id = ai.playlist_id
  LEFT JOIN firsts         fr  ON fr.campaign_id  = ai.campaign_id AND fr.playlist_id  = ai.playlist_id
  LEFT JOIN eco            eco ON eco.campaign_id = ai.campaign_id AND eco.playlist_id = ai.playlist_id
  LEFT JOIN internal_owned io  ON io.playlist_id  = ai.playlist_id
  LEFT JOIN curator_reg    cr  ON cr.campaign_id  = ai.campaign_id AND cr.playlist_id  = ai.playlist_id;
$function$;
