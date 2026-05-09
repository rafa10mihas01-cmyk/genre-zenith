
-- 1) Função que destrava coletas presas
CREATE OR REPLACE FUNCTION public.recover_stuck_auto_collect()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.curator_deal_songs
     SET auto_collect_status = 'idle',
         auto_collect_error  = 'Robô não retornou no prazo — re-agendado',
         queued_at           = NULL,
         next_auto_collect_at = GREATEST(
           COALESCE(next_auto_collect_at, now()),
           now() + interval '5 minutes'
         ),
         updated_at = now()
   WHERE auto_collect = true
     AND auto_collect_status = 'queued'
     AND queued_at IS NOT NULL
     AND queued_at < now() - interval '15 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 2) Destrava agora as que já estão presas
SELECT public.recover_stuck_auto_collect();

-- 3) Cron de 1 minuto pra rodar continuamente
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('recover-stuck-auto-collect') 
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recover-stuck-auto-collect');
    PERFORM cron.schedule(
      'recover-stuck-auto-collect',
      '* * * * *',
      $cron$SELECT public.recover_stuck_auto_collect();$cron$
    );
  END IF;
END $$;
