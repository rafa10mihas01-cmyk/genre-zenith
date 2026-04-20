-- Security definer function: any authenticated user is a team member
CREATE OR REPLACE FUNCTION public.has_team_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL;
$$;

-- Drop and recreate policies using the function
DROP POLICY IF EXISTS "auth_all_genres" ON public.genres;
DROP POLICY IF EXISTS "auth_all_search_terms" ON public.search_terms;
DROP POLICY IF EXISTS "auth_all_search_results" ON public.search_results;
DROP POLICY IF EXISTS "auth_all_search_tracks" ON public.search_tracks;
DROP POLICY IF EXISTS "auth_all_genre_models" ON public.genre_models;
DROP POLICY IF EXISTS "auth_all_collection_logs" ON public.collection_logs;

-- genres
CREATE POLICY "team_select_genres" ON public.genres FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_genres" ON public.genres FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_genres" ON public.genres FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_genres" ON public.genres FOR DELETE TO authenticated USING (public.has_team_access());

-- search_terms
CREATE POLICY "team_select_search_terms" ON public.search_terms FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_search_terms" ON public.search_terms FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_search_terms" ON public.search_terms FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_search_terms" ON public.search_terms FOR DELETE TO authenticated USING (public.has_team_access());

-- search_results
CREATE POLICY "team_select_search_results" ON public.search_results FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_search_results" ON public.search_results FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_search_results" ON public.search_results FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_search_results" ON public.search_results FOR DELETE TO authenticated USING (public.has_team_access());

-- search_tracks
CREATE POLICY "team_select_search_tracks" ON public.search_tracks FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_search_tracks" ON public.search_tracks FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_search_tracks" ON public.search_tracks FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_search_tracks" ON public.search_tracks FOR DELETE TO authenticated USING (public.has_team_access());

-- genre_models
CREATE POLICY "team_select_genre_models" ON public.genre_models FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_genre_models" ON public.genre_models FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_genre_models" ON public.genre_models FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_genre_models" ON public.genre_models FOR DELETE TO authenticated USING (public.has_team_access());

-- collection_logs
CREATE POLICY "team_select_collection_logs" ON public.collection_logs FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_collection_logs" ON public.collection_logs FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_collection_logs" ON public.collection_logs FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_collection_logs" ON public.collection_logs FOR DELETE TO authenticated USING (public.has_team_access());