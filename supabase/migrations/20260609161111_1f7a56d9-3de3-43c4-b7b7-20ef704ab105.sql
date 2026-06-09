CREATE OR REPLACE FUNCTION public.tg_ccp_match_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id UUID;
  v_captured_at TIMESTAMPTZ;
  v_is_baseline BOOLEAN;
BEGIN
  -- Proteção permanente: playlist do ecossistema interno nunca pode virar
  -- entrega atribuída a curador externo nesta tabela de vínculo de campanha.
  IF NEW.playlist_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.managed_playlists mp
    WHERE mp.spotify_playlist_id = NEW.playlist_id
  ) THEN
    SELECT collection_run_id, captured_at
      INTO v_run_id, v_captured_at
      FROM public.campaign_playlist_collections
     WHERE campaign_id = NEW.campaign_id
       AND playlist_id = NEW.playlist_id
     ORDER BY captured_at ASC
     LIMIT 1;

    NEW.status := 'baseline_conflict';
    NEW.matched_at := NULL;
    NEW.first_seen_collection_run_id := COALESCE(NEW.first_seen_collection_run_id, v_run_id);
    NEW.baseline_conflict_at := COALESCE(NEW.baseline_conflict_at, now());
    NEW.baseline_conflict_source := COALESCE(NEW.baseline_conflict_source, 'internal_ecosystem_owner');
    NEW.excluded_from_kpis := true;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'pending_match' THEN
    RETURN NEW;
  END IF;

  SELECT collection_run_id, captured_at, COALESCE(is_baseline, false)
    INTO v_run_id, v_captured_at, v_is_baseline
    FROM public.campaign_playlist_collections
   WHERE campaign_id = NEW.campaign_id
     AND playlist_id = NEW.playlist_id
   ORDER BY captured_at ASC
   LIMIT 1;

  IF v_run_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_is_baseline THEN
    NEW.status := 'baseline_conflict';
    NEW.matched_at := NULL;
    NEW.first_seen_collection_run_id := v_run_id;
    NEW.baseline_conflict_at := now();
    NEW.baseline_conflict_source := 'trigger_match_on_insert';
    NEW.excluded_from_kpis := true;
  ELSE
    NEW.status := 'matched';
    NEW.matched_at := v_captured_at;
    NEW.first_seen_collection_run_id := v_run_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ccp_match_on_insert ON public.curator_campaign_playlists;
CREATE TRIGGER trg_ccp_match_on_insert
BEFORE INSERT OR UPDATE ON public.curator_campaign_playlists
FOR EACH ROW
EXECUTE FUNCTION public.tg_ccp_match_on_insert();

CREATE OR REPLACE FUNCTION public.match_curator_campaign_playlists(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_promoted int := 0;
BEGIN
  WITH promotable AS (
    SELECT DISTINCT ccp.curator_id, ccp.playlist_id
    FROM public.curator_campaign_playlists ccp
    JOIN public.curator_deals cd
      ON cd.campaign_id = ccp.campaign_id
     AND cd.curator_id  = ccp.curator_id
    JOIN public.curator_playlists cp
      ON cp.deal_id = cd.id
     AND cp.spotify_playlist_id = ccp.playlist_id
     AND cp.match_status = 'curator'
     AND COALESCE(cp.is_observational, false) = false
    WHERE ccp.campaign_id = p_campaign_id
      AND ccp.status = 'pending_match'
      AND COALESCE(ccp.excluded_from_kpis, false) = false
      AND NOT EXISTS (
        SELECT 1
        FROM public.managed_playlists mp
        WHERE mp.spotify_playlist_id = ccp.playlist_id
      )
  ),
  upd AS (
    UPDATE public.curator_campaign_playlists ccp
       SET status = 'matched'
      FROM promotable p
     WHERE ccp.campaign_id = p_campaign_id
       AND ccp.curator_id  = p.curator_id
       AND ccp.playlist_id = p.playlist_id
       AND ccp.status      = 'pending_match'
    RETURNING 1
  )
  SELECT count(*) INTO v_promoted FROM upd;

  RETURN jsonb_build_object('campaign_id', p_campaign_id, 'promoted', v_promoted);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.match_curator_campaign_playlists(uuid) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.vw_campaign_playlist_growth AS
WITH baseline AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id,
         plays_7d AS baseline_plays,
         playlist_name_at_capture AS baseline_name,
         captured_at AS baseline_at
  FROM public.campaign_playlist_collections
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
  FROM public.campaign_playlist_collections
  ORDER BY campaign_id, playlist_id, captured_at DESC, created_at DESC
), all_ids AS (
  SELECT DISTINCT campaign_id, playlist_id
  FROM public.campaign_playlist_collections
), eco AS (
  SELECT a.campaign_id, mp.spotify_playlist_id AS playlist_id
  FROM public.campaign_eco_allocations a
  JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
  WHERE mp.spotify_playlist_id IS NOT NULL
), internal_owned AS (
  SELECT DISTINCT mp.spotify_playlist_id AS playlist_id
  FROM public.managed_playlists mp
  WHERE mp.spotify_playlist_id IS NOT NULL
), curator_reg AS (
  SELECT DISTINCT ON (campaign_id, playlist_id)
         campaign_id, playlist_id, curator_id, status, excluded_from_kpis
  FROM public.curator_campaign_playlists
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
         WHEN eco.playlist_id IS NOT NULL THEN 'ecosystem'::text
         WHEN io.playlist_id IS NOT NULL THEN 'organic'::text
         WHEN cr.curator_id IS NOT NULL AND COALESCE(cr.excluded_from_kpis, false) = false THEN 'curator:'::text || cr.curator_id::text
         WHEN cr.curator_id IS NOT NULL AND cr.status = 'baseline_conflict' THEN 'curator:'::text || cr.curator_id::text
         ELSE 'organic'::text
       END AS attributed_to,
       CASE
         WHEN eco.playlist_id IS NOT NULL OR io.playlist_id IS NOT NULL THEN NULL::uuid
         ELSE cr.curator_id
       END AS attributed_curator_id,
       CASE
         WHEN eco.playlist_id IS NOT NULL OR io.playlist_id IS NOT NULL THEN false
         ELSE (cr.status = 'baseline_conflict')
       END AS is_baseline_conflict,
       CASE
         WHEN eco.playlist_id IS NOT NULL THEN false
         WHEN io.playlist_id IS NOT NULL THEN true
         ELSE COALESCE(cr.excluded_from_kpis, false)
       END AS excluded_from_kpis
FROM all_ids ai
LEFT JOIN baseline b ON b.campaign_id = ai.campaign_id AND b.playlist_id = ai.playlist_id
LEFT JOIN latest l ON l.campaign_id = ai.campaign_id AND l.playlist_id = ai.playlist_id
LEFT JOIN eco ON eco.campaign_id = ai.campaign_id AND eco.playlist_id = ai.playlist_id
LEFT JOIN internal_owned io ON io.playlist_id = ai.playlist_id
LEFT JOIN curator_reg cr ON cr.campaign_id = ai.campaign_id AND cr.playlist_id = ai.playlist_id;

ALTER VIEW public.vw_campaign_playlist_growth SET (security_invoker = true);
GRANT SELECT ON public.vw_campaign_playlist_growth TO authenticated;
GRANT SELECT ON public.vw_campaign_playlist_growth TO anon;
GRANT SELECT ON public.vw_campaign_playlist_growth TO service_role;

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
  FROM public.campaign_eco_allocations a
  LEFT JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
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
  FROM public.curator_campaign_playlists c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.managed_playlists mp
    WHERE mp.spotify_playlist_id = c.playlist_id
  )
), col AS (
  SELECT campaign_id,
         playlist_id,
         min(first_seen_at) AS first_seen_at,
         max(captured_at) AS last_collected_at,
         bool_or(is_baseline) AS has_baseline,
         max(playlist_name_at_capture) AS playlist_name_collected
  FROM public.campaign_playlist_collections
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

ALTER VIEW public.campaign_playlist_inventory_v1 SET (security_invoker = true);
GRANT SELECT ON public.campaign_playlist_inventory_v1 TO authenticated;
GRANT SELECT ON public.campaign_playlist_inventory_v1 TO service_role;