DROP POLICY IF EXISTS "authenticated_read_catalog_placement_execution_log" ON public.catalog_placement_execution_log;
CREATE POLICY "team_read_catalog_placement_execution_log"
ON public.catalog_placement_execution_log
FOR SELECT TO authenticated
USING (public.has_team_access());

DROP POLICY IF EXISTS "observed snapshots read auth" ON public.observed_playlist_snapshots;

DROP POLICY IF EXISTS "Authenticated can read catalog song snapshots" ON public.song_snapshots;
CREATE POLICY "Team can read catalog song snapshots"
ON public.song_snapshots
FOR SELECT TO authenticated
USING (catalog_track_id IS NOT NULL AND public.has_team_access());

DROP POLICY IF EXISTS "Authenticated can read catalog snapshot playlists" ON public.song_snapshot_playlists;
CREATE POLICY "Team can read catalog snapshot playlists"
ON public.song_snapshot_playlists
FOR SELECT TO authenticated
USING (
  public.has_team_access()
  AND EXISTS (
    SELECT 1 FROM public.song_snapshots s
    WHERE s.id = song_snapshot_playlists.snapshot_id
      AND s.catalog_track_id IS NOT NULL
  )
);