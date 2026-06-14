ALTER VIEW public.v_catalog_track_telemetry SET (security_invoker = true);
ALTER VIEW public.v_catalog_track_playlist_attribution SET (security_invoker = true);

GRANT SELECT ON public.v_catalog_track_telemetry TO anon, authenticated, service_role;
GRANT SELECT ON public.v_catalog_track_playlist_attribution TO anon, authenticated, service_role;
GRANT SELECT ON public.song_snapshots TO anon, authenticated;
GRANT SELECT ON public.song_snapshot_playlists TO anon, authenticated;

CREATE POLICY "Anon can read catalog song snapshots"
ON public.song_snapshots
FOR SELECT
TO anon
USING (catalog_track_id IS NOT NULL);

CREATE POLICY "Anon can read catalog snapshot playlists"
ON public.song_snapshot_playlists
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1
    FROM public.song_snapshots s
    WHERE s.id = song_snapshot_playlists.snapshot_id
      AND s.catalog_track_id IS NOT NULL
  )
);