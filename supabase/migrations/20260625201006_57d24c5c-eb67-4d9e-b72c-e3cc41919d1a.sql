
DROP POLICY IF EXISTS "Authenticated can read snapshots" ON public.analysis_snapshots;
CREATE POLICY "Team can read snapshots" ON public.analysis_snapshots FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS "Authenticated can read snapshot results" ON public.analysis_snapshot_results;
CREATE POLICY "Team can read snapshot results" ON public.analysis_snapshot_results FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS "Authenticated can read snapshot events" ON public.analysis_snapshot_events;
CREATE POLICY "Team can read snapshot events" ON public.analysis_snapshot_events FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS "authenticated reads distribution plans" ON public.catalog_distribution_plans;
CREATE POLICY "Team reads distribution plans" ON public.catalog_distribution_plans FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS "authenticated reads plan targets" ON public.catalog_distribution_plan_targets;
CREATE POLICY "Team reads plan targets" ON public.catalog_distribution_plan_targets FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS "authenticated can read priority runs" ON public.engine_priority_runs;
CREATE POLICY "Team can read priority runs" ON public.engine_priority_runs FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS "authenticated can read priority scores" ON public.placement_priority_scores;
CREATE POLICY "Team can read priority scores" ON public.placement_priority_scores FOR SELECT TO authenticated USING (public.has_team_access());
