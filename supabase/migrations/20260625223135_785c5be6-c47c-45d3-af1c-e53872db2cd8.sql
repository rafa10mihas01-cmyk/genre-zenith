
DROP POLICY IF EXISTS "Authenticated read occupancy plans" ON public.occupancy_plans;
CREATE POLICY "Team can read occupancy plans" ON public.occupancy_plans
  FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS "Authenticated read occupancy ops" ON public.occupancy_plan_ops;
CREATE POLICY "Team can read occupancy ops" ON public.occupancy_plan_ops
  FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS "Authenticated read occupancy queue" ON public.occupancy_rebuild_queue;
CREATE POLICY "Team can read occupancy queue" ON public.occupancy_rebuild_queue
  FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS "Authenticated can read playlist policies" ON public.playlist_editorial_policies;
DROP POLICY IF EXISTS "Authenticated can manage playlist policies" ON public.playlist_editorial_policies;
CREATE POLICY "Team can read playlist policies" ON public.playlist_editorial_policies
  FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "Team can manage playlist policies" ON public.playlist_editorial_policies
  FOR ALL TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());

DROP POLICY IF EXISTS "Authenticated can read genre policy defaults" ON public.genre_editorial_policy_defaults;
DROP POLICY IF EXISTS "Authenticated can manage genre policy defaults" ON public.genre_editorial_policy_defaults;
CREATE POLICY "Team can read genre policy defaults" ON public.genre_editorial_policy_defaults
  FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "Team can manage genre policy defaults" ON public.genre_editorial_policy_defaults
  FOR ALL TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());

DROP POLICY IF EXISTS "Authenticated can read policy alerts" ON public.playlist_policy_alerts;
CREATE POLICY "Team can read policy alerts" ON public.playlist_policy_alerts
  FOR SELECT TO authenticated USING (public.has_team_access());
