DROP POLICY IF EXISTS "deny_all_song_snapshots" ON public.song_snapshots;
DROP POLICY IF EXISTS "deny_all_song_snapshot_playlists" ON public.song_snapshot_playlists;

CREATE POLICY "Block client writes to song snapshots"
ON public.song_snapshots
AS RESTRICTIVE
FOR INSERT
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "Block client updates to song snapshots"
ON public.song_snapshots
AS RESTRICTIVE
FOR UPDATE
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY "Block client deletes from song snapshots"
ON public.song_snapshots
AS RESTRICTIVE
FOR DELETE
TO anon, authenticated
USING (false);

CREATE POLICY "Block client writes to song snapshot playlists"
ON public.song_snapshot_playlists
AS RESTRICTIVE
FOR INSERT
TO anon, authenticated
WITH CHECK (false);

CREATE POLICY "Block client updates to song snapshot playlists"
ON public.song_snapshot_playlists
AS RESTRICTIVE
FOR UPDATE
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY "Block client deletes from song snapshot playlists"
ON public.song_snapshot_playlists
AS RESTRICTIVE
FOR DELETE
TO anon, authenticated
USING (false);