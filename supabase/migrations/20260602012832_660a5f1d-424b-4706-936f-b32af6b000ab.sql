ALTER TABLE public.spotify_oauth_audit REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.spotify_oauth_audit;