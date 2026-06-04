
-- 1) Revoke column-level SELECT on token columns from JWT-bearing roles.
REVOKE SELECT (access_token) ON public.spotify_tokens FROM authenticated, anon;
REVOKE SELECT (access_token, refresh_token) ON public.spotify_user_tokens FROM authenticated, anon;

-- 2) user_roles: prevent admin-role escalation via client.
DROP POLICY IF EXISTS admins_insert_roles ON public.user_roles;
DROP POLICY IF EXISTS admins_update_roles ON public.user_roles;

CREATE POLICY admins_insert_roles ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT is_admin())
    AND role <> 'admin'::app_role
  );

CREATE POLICY admins_update_roles ON public.user_roles
  FOR UPDATE TO authenticated
  USING ((SELECT is_admin()) AND role <> 'admin'::app_role)
  WITH CHECK ((SELECT is_admin()) AND role <> 'admin'::app_role);

-- 3) Remove spotify_oauth_audit from Realtime publication.
ALTER PUBLICATION supabase_realtime DROP TABLE public.spotify_oauth_audit;

-- 4) Fix deal-prints storage policies to use ownership join.
DROP POLICY IF EXISTS "deal-prints owner update" ON storage.objects;
DROP POLICY IF EXISTS "deal-prints owner delete" ON storage.objects;

CREATE POLICY "deal-prints owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'deal-prints'
    AND EXISTS (
      SELECT 1 FROM public.curator_deals cd
      WHERE cd.id::text = (storage.foldername(objects.name))[1]
        AND cd.user_id = auth.uid()
    )
  );

CREATE POLICY "deal-prints owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'deal-prints'
    AND EXISTS (
      SELECT 1 FROM public.curator_deals cd
      WHERE cd.id::text = (storage.foldername(objects.name))[1]
        AND cd.user_id = auth.uid()
    )
  );
