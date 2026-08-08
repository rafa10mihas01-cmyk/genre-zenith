ALTER PUBLICATION supabase_realtime DROP TABLE public.placement_priority_scores;

ALTER FUNCTION public.fn_campaign_playlist_growth(uuid[]) SET work_mem = '64MB';
ALTER FUNCTION public.fn_playlist_delivery_accumulated(uuid) SET work_mem = '64MB';