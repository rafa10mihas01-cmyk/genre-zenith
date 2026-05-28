DROP FUNCTION IF EXISTS public.cleanup_old_logs_and_snapshots();

CREATE OR REPLACE FUNCTION public.cleanup_old_logs_and_snapshots()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bot int := 0;
  v_cron int := 0;
  v_col int := 0;
  v_hb int := 0;
  v_em int := 0;
  v_ai int := 0;
  v_snaps int := 0;
  v_tracks int := 0;
  v_rl int := 0;
  v_aic int := 0;
BEGIN
  WITH d AS (
    DELETE FROM public.bot_events
     WHERE (status NOT IN ('error','critical','failed') AND created_at < now() - interval '7 days')
        OR (status IN ('error','critical','failed') AND created_at < now() - interval '30 days')
     RETURNING 1
  ) SELECT count(*) INTO v_bot FROM d;

  WITH d AS (
    DELETE FROM public.cron_health
     WHERE created_at < now() - interval '14 days'
     RETURNING 1
  ) SELECT count(*) INTO v_cron FROM d;

  WITH d AS (
    DELETE FROM public.collection_logs
     WHERE created_at < now() - interval '14 days'
     RETURNING 1
  ) SELECT count(*) INTO v_col FROM d;

  WITH d AS (
    DELETE FROM public.bot_heartbeats
     WHERE created_at < now() - interval '7 days'
     RETURNING 1
  ) SELECT count(*) INTO v_hb FROM d;

  WITH d AS (
    DELETE FROM public.email_send_log
     WHERE created_at < now() - interval '60 days'
     RETURNING 1
  ) SELECT count(*) INTO v_em FROM d;

  WITH d AS (
    DELETE FROM public.ai_usage_log
     WHERE created_at < now() - interval '90 days'
     RETURNING 1
  ) SELECT count(*) INTO v_ai FROM d;

  WITH old_snaps AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY template_id, date_trunc('day', collected_at)
             ORDER BY collected_at DESC
           ) AS rn
    FROM public.playlist_metrics_snapshots
    WHERE collected_at < now() - interval '7 days'
  ),
  d AS (
    DELETE FROM public.playlist_metrics_snapshots
     WHERE id IN (SELECT id FROM old_snaps WHERE rn > 1)
     RETURNING 1
  ) SELECT count(*) INTO v_snaps FROM d;

  WITH d AS (
    DELETE FROM public.search_tracks st
     WHERE st.result_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.search_results sr WHERE sr.id = st.result_id)
     RETURNING 1
  ) SELECT count(*) INTO v_tracks FROM d;

  WITH d AS (
    DELETE FROM public.rate_limits
     WHERE window_start < now() - interval '1 day'
     RETURNING 1
  ) SELECT count(*) INTO v_rl FROM d;

  WITH d AS (
    DELETE FROM public.ai_print_cache
     WHERE last_hit_at < now() - interval '60 days'
     RETURNING 1
  ) SELECT count(*) INTO v_aic FROM d;

  RETURN jsonb_build_object(
    'bot_events_deleted', v_bot,
    'cron_health_deleted', v_cron,
    'collection_logs_deleted', v_col,
    'bot_heartbeats_deleted', v_hb,
    'email_send_log_deleted', v_em,
    'ai_usage_log_deleted', v_ai,
    'playlist_metrics_snapshots_deduped', v_snaps,
    'search_tracks_orphans_deleted', v_tracks,
    'rate_limits_deleted', v_rl,
    'ai_print_cache_deleted', v_aic,
    'ran_at', now()
  );
END;
$function$;