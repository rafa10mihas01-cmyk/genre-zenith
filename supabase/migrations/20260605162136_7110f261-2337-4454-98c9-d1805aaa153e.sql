CREATE OR REPLACE VIEW public.vw_inventory_vs_monitor_diff AS
WITH monitor AS (
  SELECT DISTINCT campaign_id, playlist_id
  FROM public.campaign_playlist_collections
  WHERE is_baseline = true AND playlist_id IS NOT NULL
)
SELECT
  i.campaign_id,
  i.playlist_id,
  i.source,
  i.state,
  i.curator_id,
  i.managed_playlist_id,
  i.playlist_name,
  i.planned_at,
  i.last_collected_at,
  (m.playlist_id IS NOT NULL) AS visible_in_monitor,
  CASE
    WHEN m.playlist_id IS NULL AND i.state IN ('planned','pending_match') THEN 'invisible_planned'
    WHEN m.playlist_id IS NULL AND i.state = 'matched'                    THEN 'invisible_matched'
    WHEN m.playlist_id IS NULL AND i.state = 'orphan_collected'           THEN 'invisible_orphan'
    ELSE 'aligned'
  END AS divergence
FROM public.campaign_playlist_inventory_v1 i
LEFT JOIN monitor m
  ON m.campaign_id = i.campaign_id
 AND m.playlist_id = i.playlist_id;

ALTER VIEW public.vw_inventory_vs_monitor_diff SET (security_invoker = true);

COMMENT ON VIEW public.vw_inventory_vs_monitor_diff IS
  'Fase 4 — diff Inventário vs Monitor (read-only). Não substitui nada. Para auditoria.';

GRANT SELECT ON public.vw_inventory_vs_monitor_diff TO authenticated;
GRANT SELECT ON public.vw_inventory_vs_monitor_diff TO service_role;