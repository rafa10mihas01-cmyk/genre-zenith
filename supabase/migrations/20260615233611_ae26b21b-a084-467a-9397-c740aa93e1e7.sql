
-- observer_runs
DROP POLICY IF EXISTS "Anyone can read runs" ON public.observer_runs;
DROP POLICY IF EXISTS "Authenticated users can manage runs" ON public.observer_runs;
CREATE POLICY "observer_runs team read" ON public.observer_runs FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "observer_runs team write" ON public.observer_runs FOR ALL TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());

-- playlist_observations
DROP POLICY IF EXISTS "Anyone can read observations" ON public.playlist_observations;
DROP POLICY IF EXISTS "Authenticated users can insert observations" ON public.playlist_observations;
CREATE POLICY "playlist_observations team read" ON public.playlist_observations FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "playlist_observations team insert" ON public.playlist_observations FOR INSERT TO authenticated WITH CHECK (public.has_team_access());

-- playlists_to_observe
DROP POLICY IF EXISTS "Anyone can read active playlists" ON public.playlists_to_observe;
DROP POLICY IF EXISTS "Authenticated users can manage playlists" ON public.playlists_to_observe;
CREATE POLICY "playlists_to_observe team read" ON public.playlists_to_observe FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "playlists_to_observe team write" ON public.playlists_to_observe FOR ALL TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());

-- curator_deal_plan_archive: remove role 'curador'
DROP POLICY IF EXISTS "Plan archive readable by team" ON public.curator_deal_plan_archive;
CREATE POLICY "Plan archive readable by team" ON public.curator_deal_plan_archive FOR SELECT TO authenticated USING (public.has_team_access());

-- curator_playlists_archive: remove role 'curador'
DROP POLICY IF EXISTS "Archive readable by team" ON public.curator_playlists_archive;
CREATE POLICY "Archive readable by team" ON public.curator_playlists_archive FOR SELECT TO authenticated USING (public.has_team_access());

-- observed_playlist_snapshots: remove leitura aberta
DROP POLICY IF EXISTS "observed_snapshots read auth" ON public.observed_playlist_snapshots;
