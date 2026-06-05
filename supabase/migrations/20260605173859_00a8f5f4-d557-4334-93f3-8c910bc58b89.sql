
-- ============================================================================
-- Fase 4-5: propagar baseline_conflict para Inventário e Monitoramento
-- ============================================================================
-- A regra de negócio oficial: playlist em status 'baseline_conflict' (música
-- já existia antes da campanha) NÃO é entrega válida. Precisa ser visível,
-- auditável e contável separadamente — nunca somada como matched.
-- ============================================================================

-- ── Inventário: surfaceia 'baseline_conflict' como state próprio
CREATE OR REPLACE VIEW public.campaign_playlist_inventory_v1 AS
WITH eco AS (
  SELECT a.campaign_id,
         mp.spotify_playlist_id AS playlist_id,
         'ecosystem'::text AS source,
         a.id::text AS source_ref,
         a.managed_playlist_id,
         NULL::uuid AS curator_id,
         mp.name AS playlist_name,
         COALESCE(a.dispatched_at, a.created_at) AS planned_at,
         a.status AS raw_status,
         mp.spotify_playlist_id IS NULL AS missing_spotify_id
  FROM campaign_eco_allocations a
  LEFT JOIN managed_playlists mp ON mp.id = a.managed_playlist_id
), cur AS (
  SELECT c.campaign_id,
         c.playlist_id,
         'curator'::text AS source,
         c.id::text AS source_ref,
         NULL::uuid AS managed_playlist_id,
         c.curator_id,
         NULL::text AS playlist_name,
         c.registered_at AS planned_at,
         c.status AS raw_status,
         c.playlist_id IS NULL OR c.playlist_id = ''::text AS missing_spotify_id
  FROM curator_campaign_playlists c
), col AS (
  SELECT campaign_id,
         playlist_id,
         min(first_seen_at) AS first_seen_at,
         max(captured_at) AS last_collected_at,
         bool_or(is_baseline) AS has_baseline,
         max(playlist_name_at_capture) AS playlist_name_collected
  FROM campaign_playlist_collections
  WHERE playlist_id IS NOT NULL
  GROUP BY campaign_id, playlist_id
), planned AS (
  SELECT campaign_id, playlist_id, source, source_ref, managed_playlist_id,
         curator_id, playlist_name, planned_at, raw_status, missing_spotify_id FROM eco
  UNION ALL
  SELECT campaign_id, playlist_id, source, source_ref, managed_playlist_id,
         curator_id, playlist_name, planned_at, raw_status, missing_spotify_id FROM cur
), planned_enriched AS (
  SELECT p.campaign_id,
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
         c.campaign_id IS NOT NULL AS has_collection
  FROM planned p
  LEFT JOIN col c ON c.campaign_id = p.campaign_id AND c.playlist_id = p.playlist_id
), orphans AS (
  SELECT c.campaign_id, c.playlist_id,
         'orphan'::text AS source,
         NULL::text AS source_ref,
         NULL::uuid AS managed_playlist_id,
         NULL::uuid AS curator_id,
         c.playlist_name_collected AS playlist_name,
         NULL::timestamp with time zone AS planned_at,
         c.first_seen_at,
         c.last_collected_at,
         NULL::text AS raw_status,
         false AS missing_spotify_id,
         true AS has_collection
  FROM col c
  WHERE NOT EXISTS (
    SELECT 1 FROM planned p
    WHERE p.campaign_id = c.campaign_id AND p.playlist_id = c.playlist_id
  )
)
SELECT campaign_id,
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
         WHEN source = 'orphan' THEN 'orphan_collected'
         -- NOVO: conflito de baseline precede qualquer outra classificação
         WHEN source = 'curator' AND raw_status = 'baseline_conflict' THEN 'baseline_conflict'
         WHEN missing_spotify_id THEN 'pending_match'
         WHEN has_collection THEN 'matched'
         WHEN planned_at IS NOT NULL AND NOT has_collection THEN 'planned'
         ELSE 'pending_match'
       END AS state
FROM (
  SELECT * FROM planned_enriched
  UNION ALL
  SELECT campaign_id, playlist_id, source, source_ref, managed_playlist_id,
         curator_id, playlist_name, planned_at, first_seen_at, last_collected_at,
         raw_status, missing_spotify_id, has_collection FROM orphans
) u;

-- ── Monitoramento: expõe is_baseline_conflict como flag explícita
CREATE OR REPLACE VIEW public.vw_campaign_playlist_growth AS
WITH baseline AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id,
         plays_7d AS baseline_plays,
         playlist_name_at_capture AS baseline_name,
         captured_at AS baseline_at
  FROM campaign_playlist_collections
  WHERE is_baseline = true
  ORDER BY campaign_id, playlist_id, captured_at DESC, created_at DESC
), latest AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id,
         plays_7d AS current_plays,
         playlist_name_at_capture AS current_name,
         playlist_url,
         captured_at AS last_captured_at,
         first_seen_at
  FROM campaign_playlist_collections
  ORDER BY campaign_id, playlist_id, captured_at DESC, created_at DESC
), all_ids AS (
  SELECT DISTINCT campaign_id, playlist_id FROM campaign_playlist_collections
), eco AS (
  SELECT a.campaign_id, mp.spotify_playlist_id AS playlist_id
  FROM campaign_eco_allocations a
  JOIN managed_playlists mp ON mp.id = a.managed_playlist_id
  WHERE mp.spotify_playlist_id IS NOT NULL
), curator_reg AS (
  -- Para a mesma (campaign, playlist) podem coexistir uma linha matched e outra
  -- baseline_conflict (curadores diferentes). Priorizamos: matched > pending > conflict.
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id, curator_id, status
  FROM curator_campaign_playlists
  ORDER BY campaign_id, playlist_id,
           CASE status
             WHEN 'matched' THEN 1
             WHEN 'pending_match' THEN 2
             WHEN 'baseline_conflict' THEN 3
             ELSE 4
           END
)
SELECT ai.campaign_id,
       ai.playlist_id,
       l.playlist_url,
       l.current_name,
       b.baseline_name,
       b.baseline_plays,
       l.current_plays,
       COALESCE(l.current_plays, 0::bigint) - COALESCE(b.baseline_plays, 0::bigint) AS delta,
       b.baseline_at,
       l.last_captured_at,
       l.first_seen_at,
       CASE
         WHEN cr.curator_id IS NOT NULL THEN 'curator:'::text || cr.curator_id::text
         WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'::text
         ELSE 'organic'::text
       END AS attributed_to,
       cr.curator_id AS attributed_curator_id,
       -- NOVA coluna: a melhor linha do curador para esta playlist é um conflito de baseline?
       (cr.status = 'baseline_conflict') AS is_baseline_conflict
FROM all_ids ai
LEFT JOIN baseline b ON b.campaign_id = ai.campaign_id AND b.playlist_id = ai.playlist_id
LEFT JOIN latest l ON l.campaign_id = ai.campaign_id AND l.playlist_id = ai.playlist_id
LEFT JOIN curator_reg cr ON cr.campaign_id = ai.campaign_id AND cr.playlist_id = ai.playlist_id
LEFT JOIN eco ON eco.campaign_id = ai.campaign_id AND eco.playlist_id = ai.playlist_id;
