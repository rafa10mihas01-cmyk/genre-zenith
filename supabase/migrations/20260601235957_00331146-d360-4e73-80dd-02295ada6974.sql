CREATE OR REPLACE FUNCTION public.sync_tier_hot_ids(p_limit int, p_cutoff timestamptz)
RETURNS TABLE(id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT mp.id
  FROM managed_playlists mp
  WHERE mp.archived_at IS NULL
    AND EXISTS (
      SELECT 1 FROM campaign_eco_allocations a
      LEFT JOIN campaigns c ON c.id = a.campaign_id
      WHERE a.managed_playlist_id = mp.id
        AND (c.status IN ('active','planning') OR a.created_at > p_cutoff)
    )
  ORDER BY mp.last_metrics_at NULLS FIRST
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.sync_tier_warm_ids(
  p_limit int, p_cutoff_imported timestamptz, p_cutoff_metrics timestamptz, p_cutoff_alloc timestamptz
)
RETURNS TABLE(id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT mp.id
  FROM managed_playlists mp
  WHERE mp.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM campaign_eco_allocations a
      LEFT JOIN campaigns c ON c.id = a.campaign_id
      WHERE a.managed_playlist_id = mp.id
        AND (c.status IN ('active','planning') OR a.created_at > p_cutoff_alloc)
    )
    AND (mp.imported_at > p_cutoff_imported OR mp.last_metrics_at > p_cutoff_metrics)
  ORDER BY mp.last_metrics_at NULLS FIRST
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.sync_tier_cold_ids(
  p_limit int, p_cutoff_imported timestamptz, p_cutoff_metrics timestamptz, p_cutoff_alloc timestamptz
)
RETURNS TABLE(id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT mp.id
  FROM managed_playlists mp
  WHERE mp.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM campaign_eco_allocations a
      LEFT JOIN campaigns c ON c.id = a.campaign_id
      WHERE a.managed_playlist_id = mp.id
        AND (c.status IN ('active','planning') OR a.created_at > p_cutoff_alloc)
    )
    AND NOT (COALESCE(mp.imported_at, 'epoch'::timestamptz) > p_cutoff_imported OR COALESCE(mp.last_metrics_at, 'epoch'::timestamptz) > p_cutoff_metrics)
  ORDER BY mp.last_metrics_at NULLS FIRST
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_tier_hot_ids(int, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_tier_warm_ids(int, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_tier_cold_ids(int, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_tier_hot_ids(int, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_tier_warm_ids(int, timestamptz, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_tier_cold_ids(int, timestamptz, timestamptz, timestamptz) TO service_role;