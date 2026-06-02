GRANT INSERT, SELECT ON public.spotify_call_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.spotify_call_log_id_seq TO service_role;