
DROP VIEW IF EXISTS public.v_catalog_playlist_occupancy CASCADE;

CREATE VIEW public.v_catalog_playlist_occupancy AS
WITH origin_counts AS (
  SELECT
    mpt.playlist_id AS managed_playlist_id,
    count(*)::int AS total_current,
    count(*) FILTER (WHERE COALESCE(o.origin,'ThirdParty') = 'Catalog')::int    AS catalog_count,
    count(*) FILTER (WHERE COALESCE(o.origin,'ThirdParty') = 'Campaign')::int   AS campaign_count,
    count(*) FILTER (WHERE COALESCE(o.origin,'ThirdParty') = 'ThirdParty')::int AS third_party_count
  FROM public.managed_playlist_tracks mpt
  LEFT JOIN public.v_playlist_track_origin o
    ON o.managed_playlist_id = mpt.playlist_id
   AND o.spotify_track_id   = mpt.spotify_track_id
  GROUP BY mpt.playlist_id
),
active_placements AS (
  SELECT managed_playlist_id, count(*)::int AS active_placements_count
    FROM public.catalog_placements
   WHERE status = 'active'
   GROUP BY managed_playlist_id
),
policy_cte AS (
  SELECT
    mp.id AS managed_playlist_id,
    COALESCE(pep.operational_ceiling,  gepd.operational_ceiling,  150)::int   AS planned_ceiling,
    COALESCE(pep.third_party_max_pct,  gepd.third_party_max_pct,  50.00)::numeric AS third_party_max_pct
  FROM public.managed_playlists mp
  LEFT JOIN public.playlist_editorial_policies pep
    ON pep.managed_playlist_id = mp.id AND pep.is_active
  LEFT JOIN public.genre_editorial_policy_defaults gepd
    ON gepd.genre_id = mp.genre_id
),
computed AS (
  SELECT
    mp.id   AS managed_playlist_id,
    mp.name AS playlist_name,
    mp.cover_url,
    mp.tracks_count,
    mp.archived_at,
    mp.campaign_reserved_slots,
    p.planned_ceiling,
    p.third_party_max_pct,
    GREATEST(p.planned_ceiling, COALESCE(oc.total_current, 0))::int AS effective_ceiling,
    COALESCE(oc.total_current, 0)     AS total_current,
    COALESCE(oc.catalog_count, 0)     AS catalog_count,
    COALESCE(oc.campaign_count, 0)    AS campaign_count,
    COALESCE(oc.third_party_count, 0) AS third_party_count,
    COALESCE(ap.active_placements_count, 0) AS active_placements_catalog
  FROM public.managed_playlists mp
  LEFT JOIN policy_cte       p  ON p.managed_playlist_id  = mp.id
  LEFT JOIN origin_counts    oc ON oc.managed_playlist_id = mp.id
  LEFT JOIN active_placements ap ON ap.managed_playlist_id = mp.id
  WHERE mp.is_catalog = true
)
SELECT
  managed_playlist_id,
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
  GREATEST(effective_ceiling - total_current, 0)::int AS free_slots,
  third_party_max_pct,
  -- Meta absoluta de Third Party na capacidade efetiva
  FLOOR(effective_ceiling * third_party_max_pct / 100.0)::int AS third_party_target,
  -- Meta de catálogo = capacidade efetiva - meta de third party
  GREATEST(effective_ceiling - FLOOR(effective_ceiling * third_party_max_pct / 100.0)::int, 0)::int AS catalog_target,
  -- Quanto falta de catálogo para atingir a meta (mínimo zero)
  GREATEST(
    GREATEST(effective_ceiling - FLOOR(effective_ceiling * third_party_max_pct / 100.0)::int, 0)::int
    - catalog_count,
    0
  )::int AS catalog_missing,
  -- Excesso de Third Party = nº de substituições naturais que ainda ocorrerão
  GREATEST(
    third_party_count - FLOOR(effective_ceiling * third_party_max_pct / 100.0)::int,
    0
  )::int AS third_party_excess,
  active_placements_catalog,
  -- Backward-compat (nomes legados, semântica nova)
  effective_ceiling AS catalog_capacity,
  total_current     AS active_placements,
  GREATEST(effective_ceiling - total_current, 0)::int AS available_slots
FROM computed;

GRANT SELECT ON public.v_catalog_playlist_occupancy TO anon, authenticated, service_role;
