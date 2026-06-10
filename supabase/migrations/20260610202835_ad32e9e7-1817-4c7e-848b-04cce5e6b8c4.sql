REVOKE ALL ON FUNCTION public.sync_deal_campaign_baseline(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_campaign_deals_baseline(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tg_sync_deal_campaign_baseline_from_deal() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tg_sync_deal_campaign_baseline_from_song() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ingest_campaign_collection_batch(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sync_deal_campaign_baseline(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_campaign_deals_baseline(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ingest_campaign_collection_batch(uuid, text, jsonb, uuid) TO service_role;