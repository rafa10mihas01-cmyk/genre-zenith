
CREATE TABLE IF NOT EXISTS public.catalog_placement_execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id uuid NOT NULL REFERENCES public.catalog_placements(id) ON DELETE CASCADE,
  catalog_track_id uuid NOT NULL REFERENCES public.catalog_tracks(id) ON DELETE CASCADE,
  managed_playlist_id uuid NOT NULL REFERENCES public.managed_playlists(id) ON DELETE CASCADE,
  spotify_playlist_id text,
  spotify_track_id text,
  position integer,
  outcome text NOT NULL CHECK (outcome IN ('active','already_present','failed','skipped')),
  error_code text,
  error_message text,
  snapshot_id text,
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_placement_exec_log_placement
  ON public.catalog_placement_execution_log(placement_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_placement_exec_log_track
  ON public.catalog_placement_execution_log(catalog_track_id, executed_at DESC);

GRANT SELECT, INSERT ON public.catalog_placement_execution_log TO authenticated;
GRANT ALL ON public.catalog_placement_execution_log TO service_role;

ALTER TABLE public.catalog_placement_execution_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_catalog_placement_execution_log"
  ON public.catalog_placement_execution_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role_write_catalog_placement_execution_log"
  ON public.catalog_placement_execution_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.v_catalog_track_distribution_stats
WITH (security_invoker = on) AS
SELECT
  ct.id AS catalog_track_id,
  ct.track_name,
  ct.artist_name,
  ct.isrc,
  ct.genre_id,
  COUNT(cp.id)::int                                                       AS placements_total,
  COUNT(cp.id) FILTER (WHERE cp.status = 'pending')::int                  AS placements_pending,
  COUNT(cp.id) FILTER (WHERE cp.status = 'active')::int                   AS placements_active,
  COUNT(cp.id) FILTER (WHERE cp.status = 'failed')::int                   AS placements_failed,
  COUNT(cp.id) FILTER (WHERE cp.status = 'removed')::int                  AS placements_removed,
  MAX(cp.added_at)                                                        AS last_active_at,
  MIN(cp.created_at)                                                      AS first_placement_at
FROM public.catalog_tracks ct
LEFT JOIN public.catalog_placements cp ON cp.catalog_track_id = ct.id
GROUP BY ct.id;

GRANT SELECT ON public.v_catalog_track_distribution_stats TO authenticated, service_role;
