
DROP POLICY IF EXISTS "genre_aliases_read_authenticated" ON public.genre_aliases;
CREATE POLICY "genre_aliases_read_team" ON public.genre_aliases
  FOR SELECT TO authenticated
  USING (public.has_team_access());

DROP POLICY IF EXISTS "observed snapshots read auth" ON public.observed_playlist_snapshots;
CREATE POLICY "observed_snapshots_read_team" ON public.observed_playlist_snapshots
  FOR SELECT TO authenticated
  USING (public.has_team_access());

DROP POLICY IF EXISTS "observed_playlists read auth" ON public.observed_playlists;
CREATE POLICY "observed_playlists_read_team" ON public.observed_playlists
  FOR SELECT TO authenticated
  USING (public.has_team_access());
