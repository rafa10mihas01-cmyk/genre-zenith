
DROP FUNCTION IF EXISTS public.recalc_campaign_progress(uuid);
DROP FUNCTION IF EXISTS public.recalc_campaign_progress();

-- Cancela o cron job legado (silencioso se já não existir)
DO $$
BEGIN
  PERFORM cron.unschedule('recalc-campaign-progress-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
