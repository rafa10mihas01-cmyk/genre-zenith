-- 1) Tabela de uso de IA
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  user_id       uuid,
  function_name text NOT NULL,
  provider      text NOT NULL DEFAULT 'lovable',
  model         text,
  tokens_in     integer,
  tokens_out    integer,
  tokens_total  integer,
  duration_ms   integer,
  status        text NOT NULL DEFAULT 'ok',
  error         text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_aiul_created_at ON public.ai_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aiul_user_month ON public.ai_usage_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aiul_function ON public.ai_usage_log (function_name, created_at DESC);

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages ai usage log"
  ON public.ai_usage_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "admins view ai usage log"
  ON public.ai_usage_log FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "users view own ai usage"
  ON public.ai_usage_log FOR SELECT
  USING (auth.uid() = user_id);

-- 2) RPC para inserir uso (fácil de chamar de edge functions)
CREATE OR REPLACE FUNCTION public.log_ai_usage(
  p_user_id       uuid,
  p_function_name text,
  p_provider      text DEFAULT 'lovable',
  p_model         text DEFAULT NULL,
  p_tokens_in     integer DEFAULT NULL,
  p_tokens_out    integer DEFAULT NULL,
  p_tokens_total  integer DEFAULT NULL,
  p_duration_ms   integer DEFAULT NULL,
  p_status        text DEFAULT 'ok',
  p_error         text DEFAULT NULL,
  p_metadata      jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.ai_usage_log (
    user_id, function_name, provider, model,
    tokens_in, tokens_out, tokens_total,
    duration_ms, status, error, metadata
  ) VALUES (
    p_user_id, p_function_name, p_provider, p_model,
    p_tokens_in, p_tokens_out, p_tokens_total,
    p_duration_ms, p_status, p_error, COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_ai_usage(uuid, text, text, text, integer, integer, integer, integer, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_ai_usage(uuid, text, text, text, integer, integer, integer, integer, text, text, jsonb) TO service_role;

-- 3) Limpeza de logs antigos
CREATE OR REPLACE FUNCTION public.cleanup_old_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col integer;
  v_bot integer;
  v_hb  integer;
  v_em  integer;
  v_ai  integer;
BEGIN
  DELETE FROM public.collection_logs WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_col = ROW_COUNT;

  DELETE FROM public.bot_events WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_bot = ROW_COUNT;

  DELETE FROM public.bot_heartbeats WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS v_hb = ROW_COUNT;

  DELETE FROM public.email_send_log WHERE created_at < now() - interval '60 days';
  GET DIAGNOSTICS v_em = ROW_COUNT;

  DELETE FROM public.ai_usage_log WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_ai = ROW_COUNT;

  RETURN jsonb_build_object(
    'collection_logs',  v_col,
    'bot_events',       v_bot,
    'bot_heartbeats',   v_hb,
    'email_send_log',   v_em,
    'ai_usage_log',     v_ai,
    'ran_at',           now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_logs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_logs() TO service_role;

-- 4) Agenda no cron (03:15 UTC diário). Remove agendamento prévio se existir.
DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'cleanup-old-logs-daily';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'cleanup-old-logs-daily',
  '15 3 * * *',
  $cron$ SELECT public.cleanup_old_logs(); $cron$
);