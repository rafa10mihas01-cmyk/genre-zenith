
-- =====================================================================
-- P0.1 — Padronizar todos os crons HTTP com x-cron-secret
-- Crons que chamam edge functions com requireTeamAccess precisam disso
-- ou retornam 401 silenciosamente.
-- =====================================================================

DO $$
DECLARE
  v_cron_url text := 'https://xtxxjmkijeyxkdyxtvsf.supabase.co/functions/v1/';
BEGIN
  -- 1. cleanup-brain (6h)
  PERFORM cron.unschedule('cleanup-brain-every-6h');
  PERFORM cron.schedule('cleanup-brain-every-6h', '0 */6 * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{"trigger":"cron"}'::jsonb
    );$q$, v_cron_url||'cleanup-brain'));

  -- 2. curator-brain-calc (9h)
  PERFORM cron.unschedule('curator-brain-calc-daily');
  PERFORM cron.schedule('curator-brain-calc-daily', '0 9 * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{"batch": true}'::jsonb
    );$q$, v_cron_url||'curator-brain-calc'));

  -- 3. evaluate-adjustment-impacts (6h)
  PERFORM cron.unschedule('evaluate-adjustment-impacts-daily');
  PERFORM cron.schedule('evaluate-adjustment-impacts-daily', '0 6 * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := jsonb_build_object('triggered_at', now())
    );$q$, v_cron_url||'evaluate-adjustment-impacts'));

  -- 4. execution-planner (every minute)
  PERFORM cron.unschedule('execution-planner-every-minute');
  PERFORM cron.schedule('execution-planner-every-minute', '* * * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{}'::jsonb
    );$q$, v_cron_url||'execution-planner'));

  -- 5. genre-benchmarks-calc (8h)
  PERFORM cron.unschedule('genre-benchmarks-calc-daily');
  PERFORM cron.schedule('genre-benchmarks-calc-daily', '0 8 * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{}'::jsonb
    );$q$, v_cron_url||'genre-benchmarks-calc'));

  -- 6. process-email-queue (every minute)
  PERFORM cron.unschedule('process-email-queue');
  PERFORM cron.schedule('process-email-queue', '* * * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{}'::jsonb
    );$q$, v_cron_url||'process-email-queue'));

  -- 7. cron-recover-print-batches (5min)
  PERFORM cron.unschedule('recover-print-batches-5min');
  PERFORM cron.schedule('recover-print-batches-5min', '*/5 * * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{}'::jsonb
    );$q$, v_cron_url||'cron-recover-print-batches'));

  -- 8. sync-kworb-charts (11:30)
  PERFORM cron.unschedule('sync-kworb-charts-daily');
  PERFORM cron.schedule('sync-kworb-charts-daily', '30 11 * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{}'::jsonb
    );$q$, v_cron_url||'sync-kworb-charts'));

  -- 9. track-external-metrics (7h)
  PERFORM cron.unschedule('track-external-metrics-daily');
  PERFORM cron.schedule('track-external-metrics-daily', '0 7 * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{}'::jsonb
    );$q$, v_cron_url||'track-external-metrics'));

  -- 10. track-playlist-metrics (12h)
  PERFORM cron.unschedule('track-playlist-metrics-6h');
  PERFORM cron.schedule('track-playlist-metrics-6h', '0 */12 * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{}'::jsonb
    );$q$, v_cron_url||'track-playlist-metrics'));

  -- 11. calculate-playlist-ecosystem-score (7:30)
  PERFORM cron.unschedule('wave-playlist-ecosystem-score-daily');
  PERFORM cron.schedule('wave-playlist-ecosystem-score-daily', '30 7 * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{"mode":"full"}'::jsonb
    );$q$, v_cron_url||'calculate-playlist-ecosystem-score'));

  -- 12. calculate-track-ecosystem-score (7h)
  PERFORM cron.unschedule('wave-track-ecosystem-score-daily');
  PERFORM cron.schedule('wave-track-ecosystem-score-daily', '0 7 * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{"mode":"full"}'::jsonb
    );$q$, v_cron_url||'calculate-track-ecosystem-score'));

  -- 13. calculate-track-playlist-fit (8h)
  PERFORM cron.unschedule('wave-track-playlist-fit-daily');
  PERFORM cron.schedule('wave-track-playlist-fit-daily', '0 8 * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{}'::jsonb
    );$q$, v_cron_url||'calculate-track-playlist-fit'));

  -- 14. expand-from-winners (6h)
  PERFORM cron.unschedule('wave3-expand-from-winners-6h');
  PERFORM cron.schedule('wave3-expand-from-winners-6h', '15 */6 * * *',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{}'::jsonb
    );$q$, v_cron_url||'expand-from-winners'));

  -- 15. weekly-followers-revalidation (semanal)
  PERFORM cron.unschedule('weekly-followers-revalidation');
  PERFORM cron.schedule('weekly-followers-revalidation', '0 4 * * 1',
    format($q$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.get_cron_secret()),
      body := '{"mode":"followers"}'::jsonb
    );$q$, v_cron_url||'enrich-playlists'));
END $$;

-- =====================================================================
-- P0.2 — Cron Health Monitor
-- Função que varre net._http_response (últimas 2h) buscando respostas
-- !=200 vindas de chamadas a /functions/v1/ e grava em collection_logs.
-- Roda a cada 10min. Detecta crons que dizem "succeeded" mas retornam
-- 401/403/404/500.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.monitor_cron_http_failures()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  v_logged integer := 0;
  v_last_check timestamptz;
  r record;
BEGIN
  -- Pega o último check pra não duplicar
  SELECT COALESCE(MAX(criado_em), now() - interval '2 hours')
    INTO v_last_check
  FROM collection_logs
  WHERE acao = 'cron_health_check';

  FOR r IN
    SELECT
      resp.id,
      resp.status_code,
      resp.created,
      resp.error_msg,
      substring(resp.content::text, 1, 300) as body_preview,
      regexp_replace(req.url, '.*functions/v1/([a-z0-9_-]+).*', '\1') as fn_name
    FROM net._http_response resp
    JOIN net.http_request_queue req ON req.id = resp.id
    WHERE resp.created > v_last_check
      AND req.url LIKE '%/functions/v1/%'
      AND (resp.status_code IS NULL OR resp.status_code NOT BETWEEN 200 AND 299)
    ORDER BY resp.created DESC
    LIMIT 200
  LOOP
    INSERT INTO collection_logs(acao, status, mensagem, metadata)
    VALUES (
      'cron_http_failure',
      'erro',
      format('%s → HTTP %s', r.fn_name, COALESCE(r.status_code::text, 'no-response')),
      jsonb_build_object(
        'function', r.fn_name,
        'status_code', r.status_code,
        'error_msg', r.error_msg,
        'body_preview', r.body_preview,
        'response_id', r.id,
        'occurred_at', r.created
      )
    );
    v_logged := v_logged + 1;
  END LOOP;

  INSERT INTO collection_logs(acao, status, mensagem, metadata)
  VALUES (
    'cron_health_check',
    'ok',
    format('checked since %s, logged %s failures', v_last_check, v_logged),
    jsonb_build_object('failures_logged', v_logged, 'since', v_last_check)
  );

  RETURN v_logged;
END $$;

-- Schedule monitor every 10 minutes
SELECT cron.schedule(
  'cron-health-monitor-10min',
  '*/10 * * * *',
  $$SELECT public.monitor_cron_http_failures();$$
);
