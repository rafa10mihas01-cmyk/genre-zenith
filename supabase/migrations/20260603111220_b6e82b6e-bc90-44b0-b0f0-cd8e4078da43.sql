
DROP POLICY IF EXISTS "Team can read plan versions" ON public.campaign_plan_versions;
CREATE POLICY "Team can read plan versions" ON public.campaign_plan_versions
  FOR SELECT TO authenticated USING (has_team_access());

DROP POLICY IF EXISTS "Authenticated can read genre capacity matrix" ON public.genre_capacity_matrix;
CREATE POLICY "Team can read genre capacity matrix" ON public.genre_capacity_matrix
  FOR SELECT TO authenticated USING (has_team_access());

DROP POLICY IF EXISTS "Team can read CB log" ON public.spotify_circuit_breaker_log;
CREATE POLICY "Team can read CB log" ON public.spotify_circuit_breaker_log
  FOR SELECT TO authenticated USING (has_team_access());

DROP POLICY IF EXISTS "team read editorial_blocklist" ON public.spotify_editorial_blocklist;
CREATE POLICY "team read editorial_blocklist" ON public.spotify_editorial_blocklist
  FOR SELECT TO authenticated USING (has_team_access());
