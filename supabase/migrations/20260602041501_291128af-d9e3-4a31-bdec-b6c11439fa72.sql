ALTER TABLE public.system_flags
ADD COLUMN IF NOT EXISTS execution_queue_internal_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.system_flags.execution_queue_internal_enabled IS 'Quando true, o pg_cron interno chama bot-execution-queue 1x/min. Desligar instantaneamente desabilita o drenamento sem remover o cron.';