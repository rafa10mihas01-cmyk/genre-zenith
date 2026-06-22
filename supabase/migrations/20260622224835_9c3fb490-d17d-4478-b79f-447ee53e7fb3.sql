-- Etapa 2B — RPC especializada com predicate pushdown
-- Contrato funcional IDÊNTICO à view vw_campaign_playlist_growth.
-- Diferença única: processa apenas as campanhas em p_campaign_ids,
-- eliminando o desperdício de calcular o universo inteiro.

CREATE OR REPLACE FUNCTION public.fn_campaign_playlist_growth(p_campaign_ids uuid[])
RETURNS TABLE (
  campaign_id          uuid,
  playlist_id          text,
  playlist_url         text,
  current_name         text,
  baseline_name        text,
  baseline_plays       bigint,
  current_plays        bigint,
  delivery_accumulated bigint,
  delta                bigint,
  last_import_delta    bigint,
  baseline_at          timestamptz,
  last_captured_at     timestamptz,
  first_seen_at        timestamptz,
  attributed_to        text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH valid_collections AS (
    SELECT
      c.id,
      c.campaign_id,
      c.playlist_id,
      c.playlist_url,
      c.playlist_name_at_capture,
      c.plays_7d,
      c.captured_at,
      c.is_baseline,
      c.first_seen_at,
      c.created_at,
      c.upload_id,
      COALESCE(u.reference_date, (c.captured_at AT TIME ZONE 'UTC')::date) AS ref_date,
      COALESCE(u.created_at, c.created_at) AS upload_created
    FROM public.campaign_playlist_collections c
    LEFT JOIN public.label_spreadsheet_uploads u ON u.id = c.upload_id
    WHERE c.campaign_id = ANY(p_campaign_ids)
      AND COALESCE(c.excluded, false) = false
      AND (
        u.id IS NULL
        OR (u.quarantined_at IS NULL AND COALESCE(u.status, 'imported') <> 'superseded')
      )
  ),
  baseline AS (
    SELECT DISTINCT ON (vc.campaign_id, vc.playlist_id)
      vc.campaign_id,
      vc.playlist_id,
      vc.plays_7d                  AS baseline_plays,
      vc.playlist_name_at_capture  AS baseline_name,
      vc.captured_at               AS baseline_at
    FROM valid_collections vc
    WHERE vc.is_baseline = true
    ORDER BY
      vc.campaign_id, vc.playlist_id,
      vc.ref_date DESC, vc.upload_created DESC,
      vc.captured_at DESC, vc.created_at DESC
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
      vc.ref_date DESC, vc.upload_created DESC,
      vc.captured_at DESC, vc.created_at DESC
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
    lm.latest_plays                              AS current_plays,
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
  LEFT JOIN baseline       b  ON b.campaign_id  = ai.campaign_id AND b.playlist_id  = ai.playlist_id
  LEFT JOIN latest_meta    lm ON lm.campaign_id = ai.campaign_id AND lm.playlist_id = ai.playlist_id
  LEFT JOIN acc            acc ON acc.campaign_id = ai.campaign_id AND acc.playlist_id = ai.playlist_id
  LEFT JOIN firsts         fr ON fr.campaign_id = ai.campaign_id AND fr.playlist_id = ai.playlist_id
  LEFT JOIN eco            eco ON eco.campaign_id = ai.campaign_id AND eco.playlist_id = ai.playlist_id
  LEFT JOIN internal_owned io ON io.playlist_id  = ai.playlist_id
  LEFT JOIN curator_reg    cr ON cr.campaign_id  = ai.campaign_id AND cr.playlist_id  = ai.playlist_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_campaign_playlist_growth(uuid[]) TO authenticated, service_role, anon;

COMMENT ON FUNCTION public.fn_campaign_playlist_growth(uuid[]) IS
'Etapa 2B — Equivalente funcional de vw_campaign_playlist_growth com predicate pushdown. Processa apenas as campanhas listadas em p_campaign_ids. Contrato (colunas e cálculos) é IDÊNTICO à view. View permanece ativa para migração gradual dos callers.';