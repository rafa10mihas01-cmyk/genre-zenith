-- Convert security definer views to security invoker so they enforce the
-- querying user's RLS instead of the creator's privileges.
ALTER VIEW public.v_catalog_occupancy_by_genre   SET (security_invoker = on);
ALTER VIEW public.v_occupancy_executor_metrics   SET (security_invoker = on);
ALTER VIEW public.v_catalog_playlist_occupancy   SET (security_invoker = on);
ALTER VIEW public.v_catalog_origin_summary       SET (security_invoker = on);
ALTER VIEW public.v_occupancy_rebuild_metrics    SET (security_invoker = on);
ALTER VIEW public.v_playlist_track_origin        SET (security_invoker = on);

-- Pin search_path on the one project-owned function flagged by the linter.
ALTER FUNCTION public.tg_set_updated_at() SET search_path = public;