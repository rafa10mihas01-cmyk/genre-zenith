
-- Fase 1: tabela de log de chamadas Spotify (baseline de observabilidade).
-- Toda chamada feita pelo spotify-client registra um row aqui (async, fail-silent).
CREATE TABLE IF NOT EXISTS public.spotify_call_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  function_name TEXT,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  app_id UUID,
  app_name TEXT,
  http_status INT,
  status TEXT NOT NULL,
  duration_ms INT,
  attempts INT NOT NULL DEFAULT 1,
  retry_after_sec INT,
  breaker_open BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  meta JSONB
);

CREATE INDEX IF NOT EXISTS idx_spotify_call_log_created_at ON public.spotify_call_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spotify_call_log_endpoint_created ON public.spotify_call_log (endpoint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spotify_call_log_app_created ON public.spotify_call_log (app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spotify_call_log_status_created ON public.spotify_call_log (status, created_at DESC) WHERE status <> 'ok';
CREATE INDEX IF NOT EXISTS idx_spotify_call_log_function_created ON public.spotify_call_log (function_name, created_at DESC);

GRANT SELECT, INSERT ON public.spotify_call_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.spotify_call_log_id_seq TO authenticated;
GRANT ALL ON public.spotify_call_log TO service_role;
GRANT ALL ON SEQUENCE public.spotify_call_log_id_seq TO service_role;

ALTER TABLE public.spotify_call_log ENABLE ROW LEVEL SECURITY;

-- Apenas admin lê (consumido pelo painel /sistema/spotify na Fase 4).
-- Service role escreve (edge functions). Sem acesso anônimo.
CREATE POLICY "Admins can read spotify_call_log"
  ON public.spotify_call_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Retenção: 30 dias. Limpeza diária (chamada por cron na Fase 4; criada já agora para idempotência).
CREATE OR REPLACE FUNCTION public.cleanup_spotify_call_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.spotify_call_log WHERE created_at < now() - interval '30 days';
$$;
