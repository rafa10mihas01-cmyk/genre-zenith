-- 1) Restrict SELECT on internal analytics tables to team members
DO $$
DECLARE
  t text;
  p record;
  tables text[] := ARRAY[
    'genre_brain_history','genre_lexicon_history','genre_trend_events','genre_trends',
    'genre_affinities','genre_visual_signature','genre_seo_lexicon',
    'playlist_leadership','playlist_leadership_history','playlist_clusters',
    'playlist_cluster_members','playlist_genre_history','playlist_drift_snapshots',
    'playlist_followers_snapshots','playlist_track_snapshots','raw_chart_daily','genre_brain'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- drop existing SELECT policies on the table
    FOR p IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND cmd = 'SELECT'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;

    -- create team-only SELECT
    EXECUTE format(
      'CREATE POLICY "Team members can read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.has_team_access())',
      t
    );
  END LOOP;
END $$;

-- 2) Storage policies for label-spreadsheets (INSERT + DELETE for team)
CREATE POLICY "Team can upload label-spreadsheets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'label-spreadsheets' AND public.has_team_access());

CREATE POLICY "Team can delete label-spreadsheets"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'label-spreadsheets' AND public.has_team_access());

-- 3) Storage UPDATE policy for ops-uploads (admins)
CREATE POLICY "Admins can update ops-uploads"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'ops-uploads' AND public.is_current_user_admin())
WITH CHECK (bucket_id = 'ops-uploads' AND public.is_current_user_admin());
