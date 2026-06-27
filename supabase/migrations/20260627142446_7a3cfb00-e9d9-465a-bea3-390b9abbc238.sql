
-- 1) Reativar o cron 140 com schedule */5 * * * *
SELECT cron.alter_job(
  job_id := 140,
  schedule := '*/5 * * * *',
  active := true
);

-- 2) Monitor de saúde: detecta regressão (nenhum periodic enfileirado por >15 min)
CREATE OR REPLACE FUNCTION public.monitor_catalog_periodic_producer()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_periodic_at timestamptz;
  v_minutes_idle int;
  v_threshold_min int := 15; -- >2 ciclos de 5min
BEGIN
  SELECT max(created_at) INTO v_last_periodic_at
  FROM public.catalog_snapshot_queue
  WHERE reason = 'periodic';

  v_minutes_idle := COALESCE(
    EXTRACT(EPOCH FROM (now() - v_last_periodic_at)) / 60,
    99999
  )::int;

  IF v_minutes_idle > v_threshold_min THEN
    PERFORM public.create_notification(
      p_type        := 'critical',
      p_title       := 'Produtor periódico do catálogo parado',
      p_message     := 'Nenhuma música do catálogo foi enfileirada (reason=periodic) há ' || v_minutes_idle ||
                       ' minutos. Esperado: a cada 5 min. Impacto: BCT/catálogo deixam de coletar. ' ||
                       'Ação: verifique o cron jobid=140 (enqueue-catalog-snapshots-hourly).',
      p_action_url  := '/sistema?tab=saude',
      p_metadata    := jsonb_build_object(
        'domain', 'system',
        'severity', 'high',
        'kind', 'catalog_periodic_producer_stale',
        'action_required', true,
        'minutes_idle', v_minutes_idle,
        'last_periodic_at', v_last_periodic_at
      ),
      p_dedupe_key       := 'catalog_periodic_producer_stale',
      p_cooldown_minutes := 60
    );
  ELSE
    PERFORM public.resolve_notifications_by_dedupe(
      p_dedupe_key := 'catalog_periodic_producer_stale',
      p_resolution_message := 'Produtor periódico do catálogo voltou a enfileirar.'
    );
  END IF;
END;
$$;

-- 3) Agendar o monitor a cada 5 minutos
SELECT cron.schedule(
  'monitor-catalog-periodic-producer',
  '*/5 * * * *',
  $$ SELECT public.monitor_catalog_periodic_producer(); $$
);
