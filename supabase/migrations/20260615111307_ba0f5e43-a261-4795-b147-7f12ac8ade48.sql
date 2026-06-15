
-- catalog_distribution_batches
DROP POLICY IF EXISTS "authenticated_full_access_catalog_distribution_batches" ON public.catalog_distribution_batches;
CREATE POLICY "team_full_access_catalog_distribution_batches"
  ON public.catalog_distribution_batches FOR ALL TO authenticated
  USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "service_role_all_catalog_distribution_batches"
  ON public.catalog_distribution_batches FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- catalog_placements
DROP POLICY IF EXISTS "authenticated_full_access_catalog_placements" ON public.catalog_placements;
CREATE POLICY "team_full_access_catalog_placements"
  ON public.catalog_placements FOR ALL TO authenticated
  USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "service_role_all_catalog_placements"
  ON public.catalog_placements FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- catalog_track_baselines
DROP POLICY IF EXISTS "authenticated_full_access_catalog_track_baselines" ON public.catalog_track_baselines;
CREATE POLICY "team_full_access_catalog_track_baselines"
  ON public.catalog_track_baselines FOR ALL TO authenticated
  USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "service_role_all_catalog_track_baselines"
  ON public.catalog_track_baselines FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- catalog_track_snapshots (mantém service_role policy existente)
DROP POLICY IF EXISTS "catalog_track_snapshots_auth_read" ON public.catalog_track_snapshots;
CREATE POLICY "catalog_track_snapshots_team_read"
  ON public.catalog_track_snapshots FOR SELECT TO authenticated
  USING (public.has_team_access());

-- catalog_tracks
DROP POLICY IF EXISTS "authenticated_full_access_catalog_tracks" ON public.catalog_tracks;
CREATE POLICY "team_full_access_catalog_tracks"
  ON public.catalog_tracks FOR ALL TO authenticated
  USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "service_role_all_catalog_tracks"
  ON public.catalog_tracks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- observed_playlist_snapshots (remove leitura ampla, mantém policy team)
DROP POLICY IF EXISTS "observed snapshots read auth" ON public.observed_playlist_snapshots;

-- observed_playlists_blocklist
DROP POLICY IF EXISTS "blocklist read all auth" ON public.observed_playlists_blocklist;
CREATE POLICY "blocklist_read_team"
  ON public.observed_playlists_blocklist FOR SELECT TO authenticated
  USING (public.has_team_access());
