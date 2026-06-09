-- 1) Force security_invoker on the two views flagged by the linter
ALTER VIEW public.curator_playlist_library_stats SET (security_invoker = on);
ALTER VIEW public.curator_playlist_performance   SET (security_invoker = on);

-- 2) Lock down user_roles: admins can no longer freely INSERT/UPDATE non-admin
--    grants. Role assignment must go through service_role (edge functions /
--    admin tooling), eliminating the privilege escalation path.
DROP POLICY IF EXISTS admins_insert_roles ON public.user_roles;
DROP POLICY IF EXISTS admins_update_roles ON public.user_roles;