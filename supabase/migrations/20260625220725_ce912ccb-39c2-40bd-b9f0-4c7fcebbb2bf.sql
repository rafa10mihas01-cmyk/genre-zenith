-- ============================================================
-- Universo único do Occupancy Engine
-- Regra oficial: managed_playlists do gênero MENOS do_not_operate.
-- ============================================================

CREATE OR REPLACE VIEW public.v_catalog_playlist_occupancy AS
WITH origin_counts AS (
  SELECT mpt.playlist_id AS managed_playlist_id,
         count(*)::integer AS total_current,
         count(*) FILTER (WHERE COALESCE(o.origin, 'ThirdParty') = 'Catalog')::integer    AS catalog_count,
         count(*) FILTER (WHERE COALESCE(o.origin, 'ThirdParty') = 'Campaign')::integer   AS campaign_count,
         count(*) FILTER (WHERE COALESCE(o.origin, 'ThirdParty') = 'ThirdParty')::integer AS third_party_count
  FROM managed_playlist_tracks mpt
  LEFT JOIN v_playlist_track_origin o
    ON o.managed_playlist_id = mpt.playlist_id AND o.spotify_track_id = mpt.spotify_track_id
  GROUP BY mpt.playlist_id
), active_placements AS (
  SELECT managed_playlist_id, count(*)::integer AS active_placements_count
  FROM catalog_placements
  WHERE status = 'active'
  GROUP BY managed_playlist_id
), policy_cte AS (
  SELECT mp.id AS managed_playlist_id,
         COALESCE(pep.operational_ceiling, gepd.operational_ceiling, 150)        AS planned_ceiling,
         COALESCE(pep.third_party_max_pct, gepd.third_party_max_pct, 50.00)      AS third_party_max_pct,
         mp.genre_id
  FROM managed_playlists mp
  LEFT JOIN playlist_editorial_policies pep
    ON pep.managed_playlist_id = mp.id AND pep.is_active
  LEFT JOIN genre_editorial_policy_defaults gepd
    ON gepd.genre_id = mp.genre_id
), computed AS (
  SELECT mp.id AS managed_playlist_id,
         mp.name AS playlist_name,
         mp.cover_url,
         mp.tracks_count,
         mp.archived_at,
         mp.campaign_reserved_slots,
         mp.genre_id,
         p.planned_ceiling,
         p.third_party_max_pct,
         GREATEST(p.planned_ceiling, COALESCE(oc.total_current, 0)) AS effective_ceiling,
         COALESCE(oc.total_current, 0)     AS total_current,
         COALESCE(oc.catalog_count, 0)     AS catalog_count,
         COALESCE(oc.campaign_count, 0)    AS campaign_count,
         COALESCE(oc.third_party_count, 0) AS third_party_count,
         COALESCE(ap.active_placements_count, 0) AS active_placements_catalog
  FROM managed_playlists mp
  LEFT JOIN policy_cte       p  ON p.managed_playlist_id  = mp.id
  LEFT JOIN origin_counts    oc ON oc.managed_playlist_id = mp.id
  LEFT JOIN active_placements ap ON ap.managed_playlist_id = mp.id
  -- REGRA OFICIAL: universo = gênero inteiro menos do_not_operate.
  -- NÃO filtra is_catalog, archived_at, MANUAL_ONLY ou spotify_playlist_id.
  WHERE COALESCE(mp.operational_status, '') <> 'do_not_operate'
)
SELECT managed_playlist_id,
       playlist_name,
       cover_url,
       tracks_count,
       archived_at,
       campaign_reserved_slots,
       planned_ceiling,
       effective_ceiling,
       total_current,
       catalog_count,
       campaign_count,
       third_party_count,
       GREATEST(effective_ceiling - total_current, 0) AS free_slots,
       third_party_max_pct,
       floor(effective_ceiling::numeric * third_party_max_pct / 100.0)::integer AS third_party_target,
       GREATEST(effective_ceiling - floor(effective_ceiling::numeric * third_party_max_pct / 100.0)::integer, 0) AS catalog_target,
       GREATEST(GREATEST(effective_ceiling - floor(effective_ceiling::numeric * third_party_max_pct / 100.0)::integer, 0) - catalog_count, 0) AS catalog_missing,
       GREATEST(third_party_count - floor(effective_ceiling::numeric * third_party_max_pct / 100.0)::integer, 0) AS third_party_excess,
       active_placements_catalog,
       effective_ceiling AS catalog_capacity,
       total_current     AS active_placements,
       GREATEST(effective_ceiling - total_current, 0) AS available_slots,
       genre_id
FROM computed;

-- ============================================================
-- Reconciliador: mesma regra do universo.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_reconcile_catalog_pending(
  p_dry_run boolean DEFAULT true,
  p_track_id uuid DEFAULT NULL,
  p_genre_id uuid DEFAULT NULL
)
RETURNS TABLE(
  catalog_track_id uuid,
  track_name text,
  genre_id uuid,
  eligible_playlists integer,
  already_present integer,
  alive_placements integer,
  pending_created integer
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT ct.id, ct.track_name, ct.genre_id, ct.spotify_track_id
    FROM public.catalog_tracks ct
    WHERE ct.status = 'active'
      AND ct.genre_id IS NOT NULL
      AND (p_track_id IS NULL OR ct.id = p_track_id)
      AND (p_genre_id IS NULL OR ct.genre_id = p_genre_id)
  LOOP
    WITH eligible AS (
      -- REGRA OFICIAL: universo = gênero inteiro menos do_not_operate.
      SELECT mp.id
      FROM public.managed_playlists mp
      WHERE mp.genre_id = r.genre_id
        AND COALESCE(mp.operational_status,'') <> 'do_not_operate'
    ),
    present AS (
      SELECT DISTINCT mpt.playlist_id AS id
      FROM public.managed_playlist_tracks mpt
      WHERE mpt.spotify_track_id = r.spotify_track_id
        AND mpt.playlist_id IN (SELECT id FROM eligible)
    ),
    alive AS (
      SELECT cp.managed_playlist_id AS id
      FROM public.catalog_placements cp
      WHERE cp.catalog_track_id = r.id
        AND cp.status <> 'removed'
        AND cp.managed_playlist_id IN (SELECT id FROM eligible)
    ),
    todo AS (
      SELECT e.id
      FROM eligible e
      WHERE e.id NOT IN (SELECT id FROM present)
        AND e.id NOT IN (SELECT id FROM alive)
    ),
    ins AS (
      INSERT INTO public.catalog_placements (catalog_track_id, managed_playlist_id, status, origin, priority, scheduled_for)
      SELECT r.id, t.id, 'pending', 'CATALOG', 2, now()
      FROM todo t
      WHERE NOT p_dry_run
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM eligible),
      (SELECT count(*) FROM present),
      (SELECT count(*) FROM alive),
      CASE WHEN p_dry_run THEN (SELECT count(*) FROM todo) ELSE (SELECT count(*) FROM ins) END
    INTO eligible_playlists, already_present, alive_placements, pending_created;

    catalog_track_id := r.id;
    track_name       := r.track_name;
    genre_id         := r.genre_id;
    RETURN NEXT;
  END LOOP;
END;
$function$;