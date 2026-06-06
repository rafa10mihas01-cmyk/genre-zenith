ALTER VIEW public.v_curator_playlists_operational SET (security_invoker = true);
ALTER VIEW public.v_curator_playlists_observational SET (security_invoker = true);
ALTER VIEW public.campaign_playlist_inventory_v1 SET (security_invoker = true);
ALTER VIEW public.vw_campaign_playlist_growth SET (security_invoker = true);