ALTER VIEW public.v_catalog_track_telemetry SET (security_invoker = false);
ALTER VIEW public.v_catalog_track_playlist_attribution SET (security_invoker = false);

GRANT SELECT ON public.v_catalog_track_telemetry TO anon, authenticated, service_role;
GRANT SELECT ON public.v_catalog_track_playlist_attribution TO anon, authenticated, service_role;