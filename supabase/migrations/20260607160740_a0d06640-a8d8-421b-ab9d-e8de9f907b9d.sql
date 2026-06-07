ALTER VIEW public.campaign_radio_collected SET (security_invoker = false);

GRANT SELECT ON public.campaign_radio_collected TO authenticated;
GRANT ALL ON public.campaign_radio_collected TO service_role;