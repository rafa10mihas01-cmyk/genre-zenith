CREATE OR REPLACE FUNCTION public.cleanup_operational_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_heartbeats int;
  v_coll_logs int;
  v_bot_events int;
BEGIN
  WITH d AS (
    DELETE FROM public.bot_heartbeats
     WHERE created_at < now() - interval '7 days'
     RETURNING 1
  ) SELECT count(*) INTO v_heartbeats FROM d;

  WITH d AS (
    DELETE FROM public.collection_logs
     WHERE created_at < now() - interval '30 days'
     RETURNING 1
  ) SELECT count(*) INTO v_coll_logs FROM d;

  WITH d AS (
    DELETE FROM public.bot_events
     WHERE (
       (status NOT IN ('error', 'critical', 'failed') AND created_at < now() - interval '30 days')
       OR (status IN ('error', 'critical', 'failed') AND created_at < now() - interval '90 days')
     )
     RETURNING 1
  ) SELECT count(*) INTO v_bot_events FROM d;

  RETURN jsonb_build_object(
    'bot_heartbeats_deleted', v_heartbeats,
    'collection_logs_deleted', v_coll_logs,
    'bot_events_deleted', v_bot_events,
    'completed_at', now()
  );
END;
$function$;