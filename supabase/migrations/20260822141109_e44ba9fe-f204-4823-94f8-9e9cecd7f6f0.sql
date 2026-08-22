CREATE OR REPLACE FUNCTION public.cleanup_old_logs_and_snapshots()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r jsonb := '{}'::jsonb;
  n int;
BEGIN
  BEGIN
    WITH d AS (DELETE FROM public.bot_events
       WHERE (status NOT IN ('error','critical','failed') AND created_at < now() - interval '7 days')
          OR (status IN ('error','critical','failed') AND created_at < now() - interval '30 days')
       RETURNING 1) SELECT count(*) INTO n FROM d;
    r := r || jsonb_build_object('bot_events_deleted', n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('bot_events_error', SQLERRM); END;

  BEGIN
    WITH d AS (DELETE FROM public.cron_health WHERE ran_at < now() - interval '14 days' RETURNING 1)
    SELECT count(*) INTO n FROM d;
    r := r || jsonb_build_object('cron_health_deleted', n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('cron_health_error', SQLERRM); END;

  BEGIN
    WITH d AS (DELETE FROM public.collection_logs WHERE created_at < now() - interval '14 days' RETURNING 1)
    SELECT count(*) INTO n FROM d;
    r := r || jsonb_build_object('collection_logs_deleted', n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('collection_logs_error', SQLERRM); END;

  BEGIN
    WITH d AS (DELETE FROM public.bot_heartbeats WHERE created_at < now() - interval '7 days' RETURNING 1)
    SELECT count(*) INTO n FROM d;
    r := r || jsonb_build_object('bot_heartbeats_deleted', n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('bot_heartbeats_error', SQLERRM); END;

  BEGIN
    WITH d AS (DELETE FROM public.spotify_call_log WHERE created_at < now() - interval '30 days' RETURNING 1)
    SELECT count(*) INTO n FROM d;
    r := r || jsonb_build_object('spotify_call_log_deleted', n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('spotify_call_log_error', SQLERRM); END;

  BEGIN
    WITH d AS (DELETE FROM public.bot_ingest_raw WHERE expires_at < now() RETURNING 1)
    SELECT count(*) INTO n FROM d;
    r := r || jsonb_build_object('bot_ingest_raw_deleted', n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('bot_ingest_raw_error', SQLERRM); END;

  BEGIN
    WITH d AS (DELETE FROM public.email_send_log WHERE created_at < now() - interval '60 days' RETURNING 1)
    SELECT count(*) INTO n FROM d;
    r := r || jsonb_build_object('email_send_log_deleted', n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('email_send_log_error', SQLERRM); END;

  BEGIN
    WITH old_snaps AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY template_id, date_trunc('day', collected_at) ORDER BY collected_at DESC) AS rn
      FROM public.playlist_metrics_snapshots WHERE collected_at < now() - interval '7 days'
    ), d AS (DELETE FROM public.playlist_metrics_snapshots WHERE id IN (SELECT id FROM old_snaps WHERE rn > 1) RETURNING 1)
    SELECT count(*) INTO n FROM d;
    r := r || jsonb_build_object('playlist_metrics_snapshots_deduped', n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('playlist_metrics_snapshots_error', SQLERRM); END;

  BEGIN
    WITH d AS (DELETE FROM public.search_tracks st WHERE st.result_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.search_results sr WHERE sr.id = st.result_id) RETURNING 1)
    SELECT count(*) INTO n FROM d;
    r := r || jsonb_build_object('search_tracks_orphans_deleted', n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('search_tracks_error', SQLERRM); END;

  BEGIN
    WITH d AS (DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day' RETURNING 1)
    SELECT count(*) INTO n FROM d;
    r := r || jsonb_build_object('rate_limits_deleted', n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('rate_limits_error', SQLERRM); END;

  BEGIN
    WITH d AS (DELETE FROM public.ai_print_cache WHERE last_hit_at < now() - interval '60 days' RETURNING 1)
    SELECT count(*) INTO n FROM d;
    r := r || jsonb_build_object('ai_print_cache_deleted', n);
  EXCEPTION WHEN others THEN r := r || jsonb_build_object('ai_print_cache_error', SQLERRM); END;

  RETURN r || jsonb_build_object('ran_at', now());
END;
$function$;