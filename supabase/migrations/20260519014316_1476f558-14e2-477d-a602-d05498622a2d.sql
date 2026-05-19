
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
  SELECT COALESCE(MAX(created_at), now() - interval '2 hours')
    INTO v_last_check
  FROM collection_logs
  WHERE acao = 'cron_health_check';

  FOR r IN
    SELECT
      resp.id,
      resp.status_code,
      resp.created,
      resp.error_msg,
      substring(resp.content::text, 1, 200) as body_preview,
      regexp_replace(req.url, '.*functions/v1/([a-z0-9_-]+).*', '\1') as fn_name
    FROM net._http_response resp
    JOIN net.http_request_queue req ON req.id = resp.id
    WHERE resp.created > v_last_check
      AND req.url LIKE '%/functions/v1/%'
      AND (resp.status_code IS NULL OR resp.status_code NOT BETWEEN 200 AND 299)
    ORDER BY resp.created DESC
    LIMIT 200
  LOOP
    INSERT INTO collection_logs(acao, status, mensagem)
    VALUES (
      'cron_http_failure',
      'erro',
      format('%s → HTTP %s | err=%s | body=%s',
        r.fn_name,
        COALESCE(r.status_code::text, 'no-response'),
        COALESCE(r.error_msg, '-'),
        COALESCE(r.body_preview, '-'))
    );
    v_logged := v_logged + 1;
  END LOOP;

  INSERT INTO collection_logs(acao, status, mensagem)
  VALUES (
    'cron_health_check', 'ok',
    format('checked since %s, logged %s failures', v_last_check, v_logged)
  );

  RETURN v_logged;
END $$;
