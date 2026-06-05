-- =====================================================================
-- FASE 1: Camada Inventário (somente leitura, não invasiva)
-- =====================================================================
-- Esta view APENAS consolida dados existentes. Não altera nada.
-- Pode ser removida com DROP VIEW sem efeito colateral.
-- =====================================================================

CREATE OR REPLACE VIEW public.campaign_playlist_inventory_v1 AS
WITH
-- 1) Ecossistema planejado (campaign_eco_allocations -> managed_playlists)
eco AS (
  SELECT
    a.campaign_id,
    mp.spotify_playlist_id              AS playlist_id,
    'ecosystem'::text                   AS source,
    a.id::text                          AS source_ref,
    a.managed_playlist_id,
    NULL::uuid                          AS curator_id,
    mp.name                             AS playlist_name,
    COALESCE(a.dispatched_at, a.created_at) AS planned_at,
    a.status                            AS raw_status,
    mp.spotify_playlist_id IS NULL      AS missing_spotify_id
  FROM public.campaign_eco_allocations a
  LEFT JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
),
-- 2) Curador (curator_campaign_playlists) — promessa do curador no portal
cur AS (
  SELECT
    c.campaign_id,
    c.playlist_id,
    'curator'::text                     AS source,
    c.id::text                          AS source_ref,
    NULL::uuid                          AS managed_playlist_id,
    c.curator_id,
    NULL::text                          AS playlist_name,
    c.registered_at                     AS planned_at,
    c.status                            AS raw_status,
    c.playlist_id IS NULL OR c.playlist_id = '' AS missing_spotify_id
  FROM public.curator_campaign_playlists c
),
-- 3) Coletas agregadas por (campaign_id, playlist_id)
col AS (
  SELECT
    campaign_id,
    playlist_id,
    MIN(first_seen_at)                  AS first_seen_at,
    MAX(captured_at)                    AS last_collected_at,
    BOOL_OR(is_baseline)                AS has_baseline,
    MAX(playlist_name_at_capture)       AS playlist_name_collected
  FROM public.campaign_playlist_collections
  WHERE playlist_id IS NOT NULL
  GROUP BY campaign_id, playlist_id
),
-- 4) União eco + curador (registros "prometidos")
planned AS (
  SELECT campaign_id, playlist_id, source, source_ref,
         managed_playlist_id, curator_id, playlist_name,
         planned_at, raw_status, missing_spotify_id
  FROM eco
  UNION ALL
  SELECT campaign_id, playlist_id, source, source_ref,
         managed_playlist_id, curator_id, playlist_name,
         planned_at, raw_status, missing_spotify_id
  FROM cur
),
-- 5) Planejadas com coleta (LEFT JOIN para preservar planejadas sem coleta)
planned_enriched AS (
  SELECT
    p.campaign_id,
    p.playlist_id,
    p.source,
    p.source_ref,
    p.managed_playlist_id,
    p.curator_id,
    COALESCE(p.playlist_name, c.playlist_name_collected) AS playlist_name,
    p.planned_at,
    c.first_seen_at,
    c.last_collected_at,
    p.raw_status,
    p.missing_spotify_id,
    (c.campaign_id IS NOT NULL) AS has_collection
  FROM planned p
  LEFT JOIN col c
    ON c.campaign_id = p.campaign_id
   AND c.playlist_id = p.playlist_id
),
-- 6) Órfãs: coletadas mas sem origem planejada
orphans AS (
  SELECT
    c.campaign_id,
    c.playlist_id,
    'orphan'::text                       AS source,
    NULL::text                           AS source_ref,
    NULL::uuid                           AS managed_playlist_id,
    NULL::uuid                           AS curator_id,
    c.playlist_name_collected            AS playlist_name,
    NULL::timestamptz                    AS planned_at,
    c.first_seen_at,
    c.last_collected_at,
    NULL::text                           AS raw_status,
    FALSE                                AS missing_spotify_id,
    TRUE                                 AS has_collection
  FROM col c
  WHERE NOT EXISTS (
    SELECT 1 FROM planned p
    WHERE p.campaign_id = c.campaign_id
      AND p.playlist_id = c.playlist_id
  )
)
SELECT
  campaign_id,
  playlist_id,
  source,
  source_ref,
  managed_playlist_id,
  curator_id,
  playlist_name,
  planned_at,
  first_seen_at,
  last_collected_at,
  raw_status,
  missing_spotify_id,
  has_collection,
  CASE
    WHEN source = 'orphan'                          THEN 'orphan_collected'
    WHEN missing_spotify_id                         THEN 'pending_match'
    WHEN has_collection                             THEN 'matched'
    WHEN planned_at IS NOT NULL AND NOT has_collection THEN 'planned'
    ELSE 'pending_match'
  END AS state
FROM (
  SELECT * FROM planned_enriched
  UNION ALL
  SELECT * FROM orphans
) u;

COMMENT ON VIEW public.campaign_playlist_inventory_v1 IS
  'Fase 1 — Camada Inventário (read-only). Consolida eco_allocations + curator_campaign_playlists + campaign_playlist_collections em (campaign_id, playlist_id, source, state). Não substitui vw_campaign_playlist_growth. Para auditoria/reconciliação apenas.';

GRANT SELECT ON public.campaign_playlist_inventory_v1 TO authenticated;
GRANT SELECT ON public.campaign_playlist_inventory_v1 TO service_role;