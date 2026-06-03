-- Tabela de auditoria: payload bruto recebido dos bots/VPS antes de qualquer transformação
CREATE TABLE public.bot_ingest_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,                    -- ex: 'vps-prod-01', 'bot-worker', etc
  endpoint text NOT NULL,                  -- ex: 'bot-ingest-snapshot', 'bot-ingest-song-snapshot', 'bot-upload-print'
  correlation_id text,                     -- correlation id se vier no payload/headers
  worker_id text,                          -- worker_id se vier no payload
  campaign_id uuid,                        -- extraído do payload (best-effort) para busca rápida
  deal_id uuid,                            -- idem
  song_id uuid,                            -- idem
  snapshot_id uuid,                        -- idem
  payload_json jsonb NOT NULL,             -- payload literal recebido (sem transformação)
  payload_size_bytes integer,
  payload_hash text,                       -- sha256 hex do payload (dedupe / integridade)
  headers_json jsonb,                      -- subset de headers úteis (sem auth)
  http_method text,
  ip text,
  processed boolean NOT NULL DEFAULT false,
  processing_result jsonb,                 -- {status, error?, output_ids?}
  processed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

-- Índices para busca rápida (auditoria em <10s)
CREATE INDEX idx_bot_ingest_raw_created_at ON public.bot_ingest_raw (created_at DESC);
CREATE INDEX idx_bot_ingest_raw_endpoint_created ON public.bot_ingest_raw (endpoint, created_at DESC);
CREATE INDEX idx_bot_ingest_raw_correlation ON public.bot_ingest_raw (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_bot_ingest_raw_worker ON public.bot_ingest_raw (worker_id, created_at DESC) WHERE worker_id IS NOT NULL;
CREATE INDEX idx_bot_ingest_raw_campaign ON public.bot_ingest_raw (campaign_id, created_at DESC) WHERE campaign_id IS NOT NULL;
CREATE INDEX idx_bot_ingest_raw_deal ON public.bot_ingest_raw (deal_id, created_at DESC) WHERE deal_id IS NOT NULL;
CREATE INDEX idx_bot_ingest_raw_song ON public.bot_ingest_raw (song_id, created_at DESC) WHERE song_id IS NOT NULL;
CREATE INDEX idx_bot_ingest_raw_snapshot ON public.bot_ingest_raw (snapshot_id, created_at DESC) WHERE snapshot_id IS NOT NULL;
CREATE INDEX idx_bot_ingest_raw_hash ON public.bot_ingest_raw (payload_hash) WHERE payload_hash IS NOT NULL;
CREATE INDEX idx_bot_ingest_raw_expires ON public.bot_ingest_raw (expires_at);

-- GRANTs (auditoria — leitura só pra admins via has_role; service_role faz tudo)
GRANT SELECT ON public.bot_ingest_raw TO authenticated;
GRANT ALL ON public.bot_ingest_raw TO service_role;

ALTER TABLE public.bot_ingest_raw ENABLE ROW LEVEL SECURITY;

-- Somente admins leem (auditoria sensível); writes vêm exclusivamente do service_role nas edge functions
CREATE POLICY "Admins can read raw ingest"
ON public.bot_ingest_raw
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Função de expurgo (chamada por cron existente, ou manualmente)
CREATE OR REPLACE FUNCTION public.cleanup_bot_ingest_raw()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.bot_ingest_raw WHERE expires_at < now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

COMMENT ON TABLE public.bot_ingest_raw IS 'Auditoria: payload HTTP bruto recebido dos bots/VPS, antes de qualquer transformação. Retenção 30 dias (expires_at). Permite comparar payload recebido vs persistido vs exibido sem depender de logs expirados.';