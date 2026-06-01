ALTER VIEW public.campaign_radio_collected SET (security_invoker = true);
ALTER VIEW public.vw_campaign_playlist_growth SET (security_invoker = true);

ALTER FUNCTION public.sync_client_spotify_artist_id() SET search_path = public;
ALTER FUNCTION public.delete_email(queue_name text, message_id bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.enqueue_email(queue_name text, payload jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb) SET search_path = public, pgmq;