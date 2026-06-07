REVOKE EXECUTE ON FUNCTION public.get_campaign_radio_collected(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_campaign_radio_collected(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_radio_collected(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_radio_collected(uuid) TO service_role;