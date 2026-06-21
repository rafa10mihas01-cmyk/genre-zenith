
CREATE OR REPLACE VIEW public.oauth_migration_actions AS
SELECT
  omp.spotify_user_id,
  sa_cur.name      AS current_app,
  sa_cur.lifecycle_state AS current_state,
  sa_tgt.name      AS target_app,
  omp.playlists_count,
  omp.status,
  '/spotify-auth?mode=login&app_id=' || omp.target_app_id::text AS reconnect_path,
  omp.assigned_at,
  omp.completed_at
FROM public.oauth_migration_plan omp
JOIN public.spotify_apps sa_cur ON sa_cur.id = omp.current_app_id
JOIN public.spotify_apps sa_tgt ON sa_tgt.id = omp.target_app_id
ORDER BY omp.playlists_count DESC;

REVOKE ALL ON public.oauth_migration_actions FROM PUBLIC, anon;
GRANT SELECT ON public.oauth_migration_actions TO authenticated;
GRANT ALL ON public.oauth_migration_actions TO service_role;
