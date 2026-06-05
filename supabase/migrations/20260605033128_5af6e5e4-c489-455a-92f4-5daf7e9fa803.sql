REVOKE EXECUTE ON FUNCTION public.sync_campaign_curator_playlist_attribution(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tg_sync_ccp_from_curator_playlist() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tg_sync_ccp_from_curator_deal() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tg_sync_ccp_from_collection() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sync_campaign_curator_playlist_attribution(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tg_sync_ccp_from_curator_playlist() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tg_sync_ccp_from_curator_deal() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tg_sync_ccp_from_collection() TO authenticated, service_role;