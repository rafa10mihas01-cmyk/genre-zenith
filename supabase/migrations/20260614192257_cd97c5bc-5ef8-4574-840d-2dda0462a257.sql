GRANT SELECT ON public.song_snapshots TO authenticated;
GRANT SELECT ON public.song_snapshot_playlists TO authenticated;

CREATE POLICY "Authenticated can read catalog song snapshots"
ON public.song_snapshots
FOR SELECT
TO authenticated
USING (catalog_track_id IS NOT NULL);

CREATE POLICY "Authenticated can read catalog snapshot playlists"
ON public.song_snapshot_playlists
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.song_snapshots s
    WHERE s.id = song_snapshot_playlists.snapshot_id
      AND s.catalog_track_id IS NOT NULL
  )
);